/**
 * إضافة المقاييس — تسجل كل استجابة في MetricsRegistry وتكشف مسارين للمراقبة.
 *
 * ماهيتها: onResponse يسجل http_requests_total{method,route,status} و http_request_duration_ms
 * وكشف GET /metrics عام نص prometheus و GET /health/detailed خلف requireTenant.
 * وظيفتها: تمكين المراقبة التشغيلية للإطلاق بلا تسريب وبلا تبعيات خارجية.
 * كيف: MetricsRegistry حتمي — لا شبكة ولا حالة خارجية.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { MetricsRegistry } from "@agentbridge/infra";
import { errorBody } from "./error-handler.plugin.js";
import { requireTenant } from "./auth.plugin.js";
import type { ApiContainer } from "../container.js";

// سجل عام واحد يشاركه كل الطلبات — يعاد إنشاؤه لكل buildApp في الاختبارات
export const globalMetrics = new MetricsRegistry();

/** يحمل توكن الحماية من رأس Authorization بصيغة Bearer فقط */
function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (header === undefined) return null;
  const [scheme, value] = header.split(" ", 2);
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}

export function registerMetrics(app: FastifyInstance, container: ApiContainer): void {
  app.addHook("onRequest", async (request: FastifyRequest) => {
    (request as FastifyRequest & { metricsStart?: number }).metricsStart = Date.now();
  });
  // تسجيل كل استجابة — حتمي بلا شبكة
  app.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    // المسار يُنظم للوجهة حصراً (بلا استعلام) فلا code/state
    // في المقاييس ولا في أي سجل — خام req.url لا يدخل مخرجات النظام إطلاقاً.
    const route = request.routeOptions?.url ?? request.url.split("?")[0]?.split(";")[0] ?? "unknown";
    const labels = { method: request.method, route, status: String(reply.statusCode) };
    globalMetrics.inc("http_requests_total", labels);
    const start = (request as FastifyRequest & { metricsStart?: number }).metricsStart ?? Date.now();
    const duration = Date.now() - start;
    globalMetrics.histogramObserve("http_request_duration_ms", duration);
  });

  // GET /metrics — fail-closed.
  // الإنتاج: بلا METRICS_TOKEN مضبوط في الإعدادات المسار تختفي (404) —
  // لا كشف معلومات تشغيلية لمرور مجهول. توكن خاطئ = 401 موحد.
  // غير الإنتاج بلا توكن: مسموح للتطوير المحلي فقط — قرار موثق لا سهو.
  app.get("/metrics", { config: { auth: "public" } }, async (request, reply) => {
    const expected = container.config.metricsToken;
    if (expected === undefined || expected.length === 0) {
      if (container.config.nodeEnv === "production") {
        return reply.code(404).send(errorBody("NOT_FOUND", "المسار غير موجود"));
      }
    } else {
      const presented = bearerToken(request);
      // مقارنة ثابتة الزمن عبر هاش الطرفين — لا توقيت جانبي على التوكن
      const presentedMatch = presented !== null &&
        timingSafeEqual(createHash("sha256").update(presented).digest(), createHash("sha256").update(expected).digest());
      if (!presentedMatch) {
        return reply.code(401).send(errorBody("UNAUTHORIZED", "مقاييس المنصة محمية — توكن حماية ناقص أو خاطئ"));
      }
    }
    const body = globalMetrics.toPrometheus();
    return reply.header("content-type", "text/plain; charset=utf-8").send(body);
  });

  // GET /health/detailed خلف مصادقة — لا تسريب
  app.get("/health/detailed", async (request) => {
    const tenantId = requireTenant(request);
    // حالة المكونات: نحاول قراءة بسيطة من كل مخزن بلا كتابة
    let db: string = "ok";
    let redis: string = "ok";
    let pgvector: string = "ok";
    try {
      await container.semantic.listPipelines(tenantId);
    } catch { db = "degraded"; }
    try {
      await container.episodic.readEvents(tenantId, "health-check-run");
    } catch { redis = "degraded"; }
    // pgvector يشارك قاعدة البيانات — نفس db
    pgvector = db;
    return { status: "ok", db, redis, pgvector, at: new Date().toISOString() };
  });
}
