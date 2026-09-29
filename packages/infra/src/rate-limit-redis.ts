/**
 * محدد الطلبات الموزع فوق Redis — تكملة المحدد المحلي بنفس العقد.
 *
 * ماهيته: نافذة منزلقة بمجموعة مرتبة ZSET في Redis — العدّ والإدراج
 * والتقليم في سكربت Lua واحد غير قابل للقطع، فالحصة صحيحة عبر النسخ
 * (نسختان تتنافسان لا تتجاوزان السقف مجتمعتين).
 * القرار عند تعطل المخزن معلن لا صامت: fail-closed في النمط الحي —
 * رفض 503 موحد أفضل من تجاوز صامت للحدود عند سقوط المخزن المشترك؛
 * وfail-open للتطوير المحلي فقط حيث لا يدّعي النمط توزعاً.
 * كيف: نفس سطح أوامر v6 (eval) بنمط run-lock — لا عميل جديد ولا
 * مكتبة إضافية (قاعدة 22: لا تضخيم).
 */

/** قرارات الحصص — نفس شكل RateLimiter المحلي فلا كسر للمستهلكين */
export interface RateDecision {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
  readonly count: number;
}

/** سياسة تعطل المخزن — معلنة عند البناء لا عند الحدث */
export type RedisOutagePolicy = "fail-closed" | "fail-open";

export interface RedisEvalCommands {
  eval(script: string, options: { readonly keys: readonly string[]; readonly arguments: readonly string[] }): Promise<unknown>;
}

const SLIDING_WINDOW_SCRIPT = `
local removed = redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ARGV[1])
redis.call('ZADD', KEYS[1], ARGV[2], ARGV[2] .. ':' .. ARGV[3])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
local count = redis.call('ZCARD', KEYS[1])
if count > tonumber(ARGV[5]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return {'0', oldest[2], tostring(count)}
end
return {'1', '0', tostring(count)}
`;

function replyStrings(reply: unknown): string[] {
  if (!Array.isArray(reply)) return [];
  return reply.map((item) => (typeof item === "string" ? item : String(item)));
}

export interface DistributedRateLimiterOptions {
  /** بادئة مفاتيح القاعدة — تمنع تلوث عدادات القواعد المختلفة */
  readonly keyPrefix: string;
  readonly limit: number;
  readonly windowMs: number;
  readonly outagePolicy: RedisOutagePolicy;
}

/**
 * محدد موزع واحد لقاعدة واحدة. consume ذرية عبر النسخ؛ تعطل Redis
 * يعطي قراراً بسياسة المعلنة — fail-closed يرفض بلا لمس المنطق.
 */
export function createRedisRateLimiter(commands: RedisEvalCommands, options: DistributedRateLimiterOptions) {
  const evalScript = async (key: string, args: readonly string[]): Promise<string[]> =>
    commands.eval(SLIDING_WINDOW_SCRIPT, { keys: [key], arguments: [...args] }).then(replyStrings);
  return {
    readonly_brand: "redis-rate-limiter",
    limit: options.limit,
    outagePolicy: options.outagePolicy,
    async consume(key: string): Promise<RateDecision> {
      const now = Date.now();
      const redisKey = `${options.keyPrefix}:${encodeURIComponent(key)}`;
      const args = [
        String(now - options.windowMs), // ARGV[1] — حد النافذة الأدنى
        String(now),                    // ARGV[2] — الدرجة/الطابع
        `${now}:${Math.random().toString(36).slice(2, 8)}`, // ARGV[3] — عضو فريد لنفس المللي
        String(options.windowMs + 1000), // ARGV[4] — عمر المفتاح
        String(options.limit),           // ARGV[5] — السقف
      ];
      let reply: string[];
      try {
        reply = await evalScript(redisKey, args);
      } catch {
        // تعطل المخزن: قرار معلن — fail-closed يرفض (لا bypass صامت)،
        // fail-open للتطوير فقط حيث لا يدّعي النمط توزعاً
        if (options.outagePolicy === "fail-closed") {
          return { allowed: false, retryAfterSeconds: 5, count: -1 };
        }
        return { allowed: true, retryAfterSeconds: 0, count: -1 };
      }
      const [allowed, oldestScore, count] = reply;
      if (allowed === "1") return { allowed: true, retryAfterSeconds: 0, count: Number(count) };
      const retryAfter = Math.max(1, Math.ceil((Number(oldestScore) + options.windowMs - now) / 1000));
      return { allowed: false, retryAfterSeconds: retryAfter, count: Number(count) };
    },
  };
}

export type DistributedRateLimiter = ReturnType<typeof createRedisRateLimiter>;
