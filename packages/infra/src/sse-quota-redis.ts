/**
 * حصة اتصالات SSE الموزعة فوق Redis.
 *
 * ماهيته: عدّاد مقاعد لكل مستأجر في Redis عملياته (الحجز/التحرير/التجديد)
 * سكربتات Lua غير قابلة للقطع — فالحصة صحيحة عبر النسخ (مجموع اتصالات
 * النسختين لا يتجاوز السقف)، خلافاً للعدّاد المحلي العملية في
 * apps/api (sse-connection.ts) الذي يبقى افتراضي التطوير الموثق.
 * كيف: نفس سطح RedisEvalCommands بنمط rate-limit-redis — لا عميل جديد
 * ولا مكتبة إضافية (قاعدة 22: لا تضخيم).
 *
 * الحد الأمني: TTL قصير يُجدَّد مع كل heartbeat وعند الحجز/التحرير —
 * هو شبكة أمان انهيار العملية (مقعد يتيم يتحرر ذاتياً) لا آلية العد
 * الأساسية؛ لذا فشل التجديد العابر لا يُسقط اتصالاً حياً.
 * تعطل المخزن: fail-closed معلن — acquire يرمي والمسار يرفض 503
 * صريحاً (SSE_QUOTA_STORE_DOWN) بدل تجاوز صامت للسقف.
 */

import type { RedisEvalCommands } from "./rate-limit-redis.js";

/** سطح المخزن الموحد — المحلي في apps/api يغطي نفس الدلالات متزامناً */
export interface SseQuotaStore {
  readonly brand: "sse-quota-store";
  /** يحجز مقعداً — false عند بلوغ حصة المستأجر (يُرفض الاتصال قبل أي كتابة) */
  acquire(tenantId: string): Promise<boolean>;
  /** يحرر مقعداً — أرضية صفر (التحرر المزدوج لا يفسد عدّاد غيره) */
  release(tenantId: string): Promise<void>;
  /** يجدد عمر المفتاح — يُستدعى من heartbeat الاتصال الحي */
  refresh(tenantId: string): Promise<void>;
  /** للمراقبة والاختبار — عدد مقاعد المستأجر الآن */
  countOf(tenantId: string): Promise<number>;
}

export interface RedisSseQuotaOptions {
  /** بادئة المفاتيح — تعزل عدادات الحصة عن بقية مفاتيح Redis */
  readonly keyPrefix: string;
  readonly limit: number;
  /** عمر المفتاح بالمللي — يجب أن يفوق فترة heartbeat بمراحل (شبكة الأمان) */
  readonly ttlMs: number;
}

/** الحجز الذري: سقف ثم INCR مع تجديد TTL في سكربت واحد */
const ACQUIRE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then
  return {'0', tostring(current)}
end
current = redis.call('INCR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return {'1', tostring(current)}
`;

/** التحرير الذري: DECR بأرضية صفر (الحذف عند الفراغ) مع تجديد TTL */
const RELEASE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current <= 1 then
  redis.call('DEL', KEYS[1])
  return '0'
end
current = redis.call('DECR', KEYS[1])
redis.call('PEXPIRE', KEYS[1], ARGV[1])
return tostring(current)
`;

function replyStrings(reply: unknown): string[] {
  if (!Array.isArray(reply)) return [];
  return reply.map((item) => (typeof item === "string" ? item : String(item)));
}

/**
 * مخزن حصة SSE واحد فوق اتصال Redis المشترك. فشل eval يتصاعد للمسار
 * (لا قيمة مصطنعة) — المسار يترجمه 503 fail-closed معلناً.
 */
export function createRedisSseQuotaStore(commands: RedisEvalCommands, options: RedisSseQuotaOptions): SseQuotaStore {
  const keyOf = (tenantId: string): string => `${options.keyPrefix}:${encodeURIComponent(tenantId)}`;
  const evalScript = (script: string, key: string, args: readonly string[]): Promise<unknown> =>
    commands.eval(script, { keys: [key], arguments: [...args] });
  return {
    brand: "sse-quota-store",
    async acquire(tenantId) {
      const reply = replyStrings(await evalScript(ACQUIRE_SCRIPT, keyOf(tenantId), [String(options.limit), String(options.ttlMs)]));
      return reply[0] === "1";
    },
    async release(tenantId) {
      await evalScript(RELEASE_SCRIPT, keyOf(tenantId), [String(options.ttlMs)]);
    },
    async refresh(tenantId) {
      // مجرد PEXPIRE — فشله العابر لا يرفع استثناءً من هنا؛ الاتصال الحي
      // يستمر والمقعد اليتيم (إن وقع انهيار) تتحرره شبكة الأمان الزمنية
      const key = keyOf(tenantId);
      await commands.eval("return redis.call('PEXPIRE', KEYS[1], ARGV[1])", { keys: [key], arguments: [String(options.ttlMs)] });
    },
    async countOf(tenantId) {
      const reply = await commands.eval("return redis.call('GET', KEYS[1])", { keys: [keyOf(tenantId)], arguments: [] });
      if (reply === null || reply === undefined) return 0;
      return Number(reply);
    },
  };
}
