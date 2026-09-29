/**
 * إضافة حدود الخدمة — حماية قبل المصادقة وحصص بعدها.
 *
 * طبقتان بأزمنة تشغيل مختلفة في Fastify:
 *   1. onRequest (قبل المصادقة): سقف لكل IP — يصدّ فيض نقاط الدخول
 *      (تخمين مفاتيح، دفع بدايات دخول) قبل أي كلفة تحقق.
 *   2. preHandler (بعد المصادقة — Principal جاهز): حصة قراءة وحصة
 *      تشغيلات مكلفة لكل مستأجر — مفاتيح منفصلة فلا يستهلك مستأجر
 *      حصة آخر (isolation).
 * الاستجابة موحدة عبر مغلف الأخطاء مع Retry-After.
 * **معلن**: حدود محلية العملية — الموزع فوق Redis في rate-limit-redis.ts.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiContainer } from "../container.js";
import { RATE_LIMIT_RULES, RateLimiter } from "@agentbridge/infra";
import { errorBody } from "./error-handler.plugin.js";

/** سقف التشغيلات المتزامنة لكل مستأجر — سقف العمليات المكلفة */
export const MAX_CONCURRENT_RUNS_PER_TENANT = 2;

/** يرفض الطلب برداً موحداً 429 يحمل Retry-After */
function rejectTooMany(reply: FastifyReply, retryAfterSeconds: number, storeDown = false): FastifyReply {
  if (storeDown) {
    // فشل مغلق: تعطل مخزن الحصص رفض صريح 503 — لا تجاوز صامت
    return reply
      .code(503)
      .header("retry-after", String(retryAfterSeconds))
      .send(errorBody("RATE_LIMIT_STORE_DOWN", `مخزن الحصص غير متاح — أعد المحاولة بعد ${retryAfterSeconds} ثانية`));
  }
  return reply
    .code(429)
    .header("retry-after", String(retryAfterSeconds))
    .send(errorBody("RATE_LIMITED", `تجاوزت حدود الاستخدام — أعد المحاولة بعد ${retryAfterSeconds} ثانية`));
}

export function registerRateLimit(app: FastifyInstance, container: ApiContainer): void {
  // ثلاث دوائر مستقلة — سقوف مختلفة لا تتلوث عداداتها
  const preAuth = new RateLimiter(RATE_LIMIT_RULES.preAuthPerMinute);
  const tenantRead = new RateLimiter(RATE_LIMIT_RULES.tenantReadPerMinute);
  const tenantRun = new RateLimiter(RATE_LIMIT_RULES.tenantRunPerMinute);
  // في live الحصص فوق Redis عبر النسخ بفشل مغلق — المحلي
  // يبقى للتطوير/الاختبار فقط (الفرق معلن لا مخفي)
  const distributed = container.distributedRateLimiters;

  // الطبقة 1: لكل IP على نقاط الدخول العامة (والمسارات غير المطابقة) —
  // المحمية تحتها حصة المستأجر في preHandler فلا تكرار عدّ ولا ظلم عميل موثق
  app.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    const mode = (request.routeOptions.config as { auth?: string } | undefined)?.auth;
    if (mode !== "public" && mode !== undefined) return;
    const decision = distributed !== undefined
      ? await distributed.preAuth.consume(`ip:${request.ip}`)
      : preAuth.consume(`ip:${request.ip}`);
    if (!decision.allowed) await rejectTooMany(reply, decision.retryAfterSeconds, decision.count < 0);
  });

  // الطبقة 2: بعد المصادقة — حصص المستأجر (قراءات وتشغيلات مفصولة)
  app.addHook("preHandler", async (request: FastifyRequest, reply: FastifyReply) => {
    if (request.principal === undefined) return;
    const tenantId = request.principal.tenantId;
    const isRunStart = request.method === "POST" && request.routeOptions.url === "/pipelines";
    const decision = distributed !== undefined
      ? await (isRunStart ? distributed.tenantRun : distributed.tenantRead).consume(`t:${tenantId}`)
      : (isRunStart ? tenantRun : tenantRead).consume(`t:${tenantId}`);
    if (!decision.allowed) await rejectTooMany(reply, decision.retryAfterSeconds, decision.count < 0);
  });
}
