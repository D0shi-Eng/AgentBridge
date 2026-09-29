/**
 * قفل استئناف موزع — إيجار Redis بأوامر ذرية.
 *
 * ماهيته: خزن إيجارات تشغيل (owner token + lease TTL + fencing token تصاعدي)
 * يضمن أن تشغيلاً واحداً فقط ينفذ في أي لحظة **عبر العمليات** — خلافاً
 * لـisRunning داخل العملية التي تبقى تحسيناً للرسالة لا قفلاً.
 * وظيفته:
 *   - acquire: SET NX PX ذرية — إما إيجار حصري أو فشل صريح (لا انتظار).
 *   - renew/release: سكربت Lua يقارن التوكن قبل التنفيذ — مالك خاطئ يُرفض
 *     ولا يفسد إيجار غيره.
 *   - fencing token: عدّاد INCR ذري لكل runId يزيد مع كل acquire ناجح —
 *     طبقة الأرشفة الدائمة ترفض كتابات مالك قديم بطبمة أقل (لا اكتفاء بـTTL
 *     وحدها في منع stale worker).
 * كيف: أصغر سطح أوامر (نمط ADR-13): set + eval فقط؛ سكربتات Lua نصية
 * معلنة ومختبرة ضد Redis حي (الاختبار المشروط) ومحاكاة داخل الذاكرة
 * بنفس العقد للاختبارات السريعة.
 */

import { randomBytes } from "node:crypto";

/** أصغر سطح أوامر Redis الذي يحتاجه القفل (توقيع node-redis v6 الرسمي كما هو) */
export interface RedisLockCommands {
  set(key: string, value: string, options: { NX?: boolean; PX?: number }): Promise<string | null>;
  /** eval بصيغة v6: السكربت ثم كائن { keys, arguments } */
  eval(script: string, options: { readonly keys: readonly string[]; readonly arguments: readonly string[] }): Promise<unknown>;
}

export interface RunLeaseStore {
  /** يحاول تولي الإيجار — fence جديد عند النجاح، null عند احتلال آخر */
  acquire(runId: string, ttlMs: number): Promise<{ readonly acquired: true; readonly ownerToken: string; readonly fence: number } | { readonly acquired: false }>;
  /** تجديد مشروط بالمالك — false يعني فقد الإيجار (يجب إيقاف الذات فوراً) */
  renew(runId: string, ownerToken: string, ttlMs: number): Promise<boolean>;
  /** تحرير مشروط بالمالك — false يعني الإيجار ليس بملكية هذا التوكن */
  release(runId: string, ownerToken: string): Promise<boolean>;
  /** أعلى fencing token مرئي — تستعمله طبقة الأرشفة لرفض الكتابات القديمة */
  currentFence(runId: string): Promise<number>;
}

const ACQUIRE_SCRIPT = `
if redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2], 'NX') then
  return redis.call('INCR', KEYS[2])
end
return false
`;

const RENEW_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
end
return false
`;

const RELEASE_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return false
`;

const CURRENT_FENCE_SCRIPT = `
local v = redis.call('GET', KEYS[1])
if v then return tonumber(v) end
return 0
`;

function lockKey(runId: string): string {
  // أسماء ثابتة البنية — القيم القادمة من runId قد تحوي «:» فتُهرب بترميز URL
  return `runlock:lease:${encodeURIComponent(runId)}`;
}

function fenceKey(runId: string): string {
  return `runlock:fence:${encodeURIComponent(runId)}`;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * مهايئ عميل node-redis v6 إلى سطح أوامر القفل — نسخ arrays القابلة
 * للتغيير لأن توقيع v6 يعلن Array بينما واجهتنا readonly.
 * (بدل cast: تمرير صريح بنسخ — القاعدة 14 بلا any.)
 */
export function adaptRedisV6ForLock(client: {
  set(key: string, value: string, options: { NX?: boolean; PX?: number }): Promise<string | null>;
  /** نفس الشكل المعلن لتوقيع v6 (Array قابلة للتغيير) — التحويل داخل المهايئ */
  eval(script: string, options: { keys?: Array<string>; arguments?: Array<string> }): Promise<unknown>;
}): RedisLockCommands {
  return {
    set: (key, value, options) => client.set(key, value, options),
    eval: async (script, options) => client.eval(script, { keys: [...(options.keys ?? [])], arguments: [...(options.arguments ?? [])] }),
  };
}

/** تنفيذ Redis الحقيقي — يمرر له عميل node-redis v6 كما هو من apps/container */
export function createRedisRunLeaseStore(commands: RedisLockCommands): RunLeaseStore {
  const ownerToken = (): string => randomBytes(24).toString("hex");
  const evalScript = (script: string, keys: readonly string[], args: readonly string[]): Promise<unknown> =>
    commands.eval(script, { keys, arguments: args });
  return {
    async acquire(runId, ttlMs) {
      const token = ownerToken();
      const fence = await evalScript(ACQUIRE_SCRIPT, [lockKey(runId), fenceKey(runId)], [token, String(ttlMs)]);
      if (isNumber(fence) && fence > 0) {
        return { acquired: true, ownerToken: token, fence };
      }
      return { acquired: false };
    },
    async renew(runId, ownerToken, ttlMs) {
      return (await evalScript(RENEW_SCRIPT, [lockKey(runId)], [ownerToken, String(ttlMs)])) === 1;
    },
    async release(runId, ownerToken) {
      return (await evalScript(RELEASE_SCRIPT, [lockKey(runId)], [ownerToken])) === 1;
    },
    async currentFence(runId) {
      const fence = await evalScript(CURRENT_FENCE_SCRIPT, [fenceKey(runId)], []);
      return isNumber(fence) ? fence : 0;
    },
  };
}

/**
 * تنفيذ داخل الذاكرة بنفس العقد الذري — للاختبارات الوحدية والتطوير دون Redis.
 * الذرية هنا بنيوية (JS أحادي الخيط، لا await بين الفحص والكتابة) — التعدد
 * بين العمليات يثبت ضد تنفيذ Redis الحي في الاختبار المشروط.
 * now محقون لاختبار انتهاء الإيجار حتمياً بلا انتظار حقيقي.
 */
export function createInMemoryRunLeaseStore(options: { readonly now?: () => number } = {}): RunLeaseStore {
  const now = options.now ?? Date.now;
  const leases = new Map<string, { token: string; expiresAtMs: number }>();
  const fences = new Map<string, number>();
  return {
    async acquire(runId, ttlMs) {
      const existing = leases.get(runId);
      if (existing !== undefined && existing.expiresAtMs > now()) {
        return { acquired: false };
      }
      const token = randomBytes(24).toString("hex");
      leases.set(runId, { token, expiresAtMs: now() + ttlMs });
      const fence = (fences.get(runId) ?? 0) + 1;
      fences.set(runId, fence);
      return { acquired: true, ownerToken: token, fence };
    },
    async renew(runId, ownerToken, ttlMs) {
      const lease = leases.get(runId);
      if (lease === undefined || lease.token !== ownerToken || lease.expiresAtMs <= now()) return false;
      lease.expiresAtMs = now() + ttlMs;
      return true;
    },
    async release(runId, ownerToken) {
      const lease = leases.get(runId);
      if (lease === undefined || lease.token !== ownerToken) return false;
      leases.delete(runId);
      return true;
    },
    async currentFence(runId) {
      return fences.get(runId) ?? 0;
    },
  };
}
