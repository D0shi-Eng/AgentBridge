/**
 * دفتر حجوزات الميزانية الحي فوق Redis — ذرية الحجز بين العمليات.
 *
 * ينفذ عقد ReservationLedger (من @agentbridge/llm) بسكربتات Lua غير قابلة
 * للقطع: قراءة الإنفاق + جمع الحجوزات النشطة + مقارنة السقف + كتابة الحجز
 * في نص واحد — لا سباق check-then-spend بين العمليات.
 * الحجوزات hash بحقول `ceiling:expiresAtMs`؛ المنتهي يُهمل في الحساب ويسوى
 * بالسحب المحافظ. نفس سطح أوامر redis v6 كما هو (نمط run-lock).
 */

import type { ReservationLedger } from "@agentbridge/llm";
import { budgetExceeded } from "@agentbridge/llm";
import { err, ok } from "@agentbridge/shared";

export interface RedisBudgetCommands {
  get(key: string): Promise<string | null>;
  eval(script: string, options: { readonly keys: readonly string[]; readonly arguments: readonly string[] }): Promise<unknown>;
}

const RESERVE_SCRIPT = `
local existing = redis.call('HGET', KEYS[2], ARGV[1])
if existing then
  local _, exp = string.match(existing, '^([^:]+):(%d+)$')
  if exp and tonumber(exp) > tonumber(ARGV[4]) then
    return {'reused', existing}
  end
end
local spend = tonumber(redis.call('GET', KEYS[1]) or '0')
local reserved = 0
local fields = redis.call('HGETALL', KEYS[2])
for i = 2, #fields, 2 do
  local ceil, exp = string.match(fields[i], '^([^:]+):(%d+)$')
  if ceil and exp and tonumber(exp) > tonumber(ARGV[4]) then
    reserved = reserved + tonumber(ceil)
  end
end
if spend + reserved + tonumber(ARGV[2]) > tonumber(ARGV[3]) then
  return {'rejected'}
end
local value = ARGV[2] .. ':' .. ARGV[5]
redis.call('HSET', KEYS[2], ARGV[1], value)
redis.call('EXPIRE', KEYS[2], ARGV[6])
return {'reserved', value}
`;

const SETTLE_SCRIPT = `
local existing = redis.call('HGET', KEYS[2], ARGV[1])
if not existing then
  return {'no-reservation'}
end
local ceil = tonumber(string.match(existing, '^([^:]+):'))
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('INCRBYFLOAT', KEYS[1], ARGV[2])
local over = 0
if tonumber(ARGV[2]) > ceil then over = 1 end
return {'settled', over}
`;

const CANCEL_SCRIPT = `
local removed = redis.call('HDEL', KEYS[2], ARGV[1])
return {removed == 1 and 'cancelled' or 'no-reservation'}
`;

const SWEEP_SCRIPT = `
local fields = redis.call('HGETALL', KEYS[2])
local swept = 0
for i = 2, #fields, 2 do
  local ceil, exp = string.match(fields[i], '^([^:]+):(%d+)$')
  if ceil and exp and tonumber(exp) <= tonumber(ARGV[1]) then
    redis.call('HDEL', KEYS[2], fields[i - 1])
    redis.call('INCRBYFLOAT', KEYS[1], ceil)
    swept = swept + 1
  end
end
return {tostring(swept)}
`;

const RESERVED_SCRIPT = `
local fields = redis.call('HGETALL', KEYS[1])
local reserved = 0
for i = 2, #fields, 2 do
  local ceil, exp = string.match(fields[i], '^([^:]+):(%d+)$')
  if ceil and exp and tonumber(exp) > tonumber(ARGV[1]) then
    reserved = reserved + tonumber(ceil)
  end
end
return {tostring(reserved)}
`;

function budgetKeys(tenantId: string): [string, string] {
  return [`budget:spend:${encodeURIComponent(tenantId)}`, `budget:res:${encodeURIComponent(tenantId)}`];
}

function replyTexts(reply: unknown): string[] {
  if (!Array.isArray(reply)) return [];
  return reply.map((item) => (typeof item === "string" ? item : String(item)));
}

/**
 * مهايئ عميل node-redis v6 إلى سطح أوامر الدفتر — نسخ arrays لأن توقيع
 * v6 يعلن Array قابلة للتغيير بينما واجهتنا readonly (بلا cast — القاعدة 14).
 */
export function adaptRedisV6ForBudget(client: {
  get(key: string): Promise<string | null>;
  /** نفس الشكل المعلن لتوقيع v6 (Array قابلة للتغيير) — التحويل داخل المهايئ */
  eval(script: string, options: { keys?: Array<string>; arguments?: Array<string> }): Promise<unknown>;
}): RedisBudgetCommands {
  return {
    get: (key) => client.get(key),
    eval: async (script, options) => client.eval(script, { keys: [...(options.keys ?? [])], arguments: [...(options.arguments ?? [])] }),
  };
}

/** دفتر حجوزات Redis — يمرر له عميل node-redis v6 كما هو من apps/container */
export function createRedisReservationLedger(commands: RedisBudgetCommands, monthlyBudgetUsd: (tenantId: string) => number): ReservationLedger {  const evalScript = (script: string, keys: readonly string[], args: readonly string[]): Promise<string[]> =>
    commands.eval(script, { keys, arguments: args }).then(replyTexts);
  return {
    async reserve({ tenantId, idempotencyKey, ceilingUsd, ttlMs, nowMs }) {
      const [spendKey, resKey] = budgetKeys(tenantId);
      const atMs = nowMs ?? Date.now();
      const expiresAtMs = atMs + ttlMs;
      const reply = await evalScript(RESERVE_SCRIPT, [spendKey, resKey], [
        idempotencyKey, String(ceilingUsd), String(monthlyBudgetUsd(tenantId)), String(atMs), String(expiresAtMs), String(Math.ceil((ttlMs + 60_000) / 1000)),
      ]);
      if (reply[0] === "reused") {
        return ok({ tenantId, idempotencyKey, ceilingUsd, expiresAtMs, reused: true });
      }
      if (reply[0] === "reserved") {
        return ok({ tenantId, idempotencyKey, ceilingUsd, expiresAtMs, reused: false });
      }
      return err(budgetExceeded(`رُفض الحجز قبل الإرسال: سقف ${ceilingUsd.toFixed(2)}$ يجاوز ميزانية ${tenantId} المتبقية`));
    },
    async settle({ tenantId, idempotencyKey, actualUsd }) {
      const [spendKey, resKey] = budgetKeys(tenantId);
      const reply = await evalScript(SETTLE_SCRIPT, [spendKey, resKey], [idempotencyKey, String(actualUsd)]);
      if (reply[0] !== "settled") {
        return err(budgetExceeded("تسوية بلا حجز نشط — رُفضت (لا إنفاق خارج الحجز)"));
      }
      return ok({ overCeiling: reply[1] === "1" });
    },
    async cancel({ tenantId, idempotencyKey }) {
      const [spendKey, resKey] = budgetKeys(tenantId);
      await evalScript(CANCEL_SCRIPT, [spendKey, resKey], [idempotencyKey]);
      return ok(undefined);
    },
    async monthSpendUsd(tenantId) {
      const [spendKey] = budgetKeys(tenantId);
      return Number((await commands.get(spendKey)) ?? 0);
    },
    async reservedUsd(tenantId) {
      const [, resKey] = budgetKeys(tenantId);
      const reply = await evalScript(RESERVED_SCRIPT, [resKey], [String(Date.now())]);
      return Number(reply[0] ?? "0");
    },
    async sweepExpired(tenantId, nowMs) {
      const [spendKey, resKey] = budgetKeys(tenantId);
      const reply = await evalScript(SWEEP_SCRIPT, [spendKey, resKey], [String(nowMs ?? Date.now())]);
      return Number(reply[0] ?? "0");
    },
  };
}
