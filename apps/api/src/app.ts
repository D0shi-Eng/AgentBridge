/**
 * تجميع التطبيق — Fastify بالإعدادات الآمنة + الإضافات + المسارات.
 * الدالة نقية تستقبل الحاوية فتُبنى عدة مرات في الاختبارات عبر inject
 * دون منافذ حقيقية. خيار loggerOptions للاختبارات فقط (تقاط السجلات
 * في الذاكرة لإثبات عدم تسرب الأسرار) — الإنتاج يستخدم الافتراضي المرقط.
 */

import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyLoggerOptions } from "fastify";
import { buildLoggerOptions } from "@agentbridge/infra";
import type { ApiContainer } from "./container.js";
import { registerErrorHandler, errorBody } from "./plugins/error-handler.plugin.js";
import { registerAuth } from "./plugins/auth.plugin.js";
import { registerI18n } from "./plugins/i18n.plugin.js";
import { registerHealthRoutes } from "./routes/health.route.js";
import { registerProjectRoutes } from "./routes/projects.route.js";
import { registerSpecRoutes } from "./routes/specs.route.js";
import { registerPipelineRoutes } from "./routes/pipelines.route.js";
import { registerPipelineOutputs } from "./routes/pipeline-outputs.js";
import { registerCertificateRevokeRoutes } from "./routes/certificate-revoke.route.js";
import { registerVerifyRoutes } from "./routes/verify.route.js";
import { registerStatsRoutes } from "./routes/stats.route.js";
import { registerFlywheelRoutes } from "./routes/flywheel.route.js";
import { registerFlywheelAnalyticsRoutes } from "./routes/flywheel-analytics.route.js";
import { registerOpsMetricsRoutes } from "./routes/ops-metrics.route.js";
import { registerSsoRoutes } from "./routes/sso.route.js";
import { registerAuthRoutes } from "./routes/auth.route.js";
import { registerLocalAuthRoutes } from "./routes/auth-local.route.js";
import { registerOidcRoutes } from "./routes/oidc.route.js";
import { registerMetrics } from "./plugins/metrics.plugin.js";
import { registerBrowserSecurity } from "./plugins/browser-security.plugin.js";
import { registerRateLimit } from "./plugins/rate-limit.plugin.js";

export function buildApp(container: ApiContainer, loggerOptions?: FastifyLoggerOptions): FastifyInstance {
  const app = Fastify({
    logger: loggerOptions ?? buildLoggerOptions(container.config.logLevel),
    bodyLimit: 1024 * 1024,
    // آجال صارمة: لا تشغيل معلق يستهلك موارد بلا نهاية
    requestTimeout: 30_000,
    // معرف ارتباط لكل طلب — ترويسة العميل موثوقة أو UUID جديد
    genReqId: (req) => {
      const incoming = req.headers["x-request-id"];
      return typeof incoming === "string" && incoming.length >= 8 && incoming.length <= 128 && /^[A-Za-z0-9_.-]+$/u.test(incoming)
        ? incoming
        : randomUUID();
    },
  });
  // تعرض ترويسة الارتباط في الاستجابة — تتبع طرف-إلى-طرف بالسجلات
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  registerI18n(app);
  registerErrorHandler(app);
  // حسم DNS rebinding في المسار المحلي: مضيف الحلقة المسموح حصراً — أي
  // مضيف آخر (نطاق خارجي أعيد ربطه إلى 127.0.0.1) يُرفض قبل أي معالجة.
  // حماية على مستوى الخادم كله لأن إعادة الربط تستهدف الأصل لا مساراً
  if (container.config.localBootstrapEnabled) {
    const allowedHosts = new Set([`127.0.0.1:${container.config.port}`, `localhost:${container.config.port}`, `[::1]:${container.config.port}`]);
    app.addHook("onRequest", async (request, reply) => {
      if (!allowedHosts.has(String(request.headers.host ?? "").toLowerCase())) {
        return reply.code(403).send(errorBody("HOST_REJECTED", "مضيف الطلب خارج الحلقة المحلية المسموحة"));
      }
    });
  }
  // حدود الخدمة قبل المصادقة (كل IP) — ثم المصادقة — ثم حصص المستأجر في preHandler
  registerRateLimit(app, container);
  registerBrowserSecurity(app, container.config);
  registerAuth(app, container);
  registerMetrics(app, container);

  // مسارات غير مسجلة تخرج بنفس المغلف الموحد لا بجسم fastify الافتراضي
  app.setNotFoundHandler((_request, reply) => {
    void reply.code(404).send(errorBody("NOT_FOUND", "المسار غير موجود"));
  });

  registerHealthRoutes(app, container);
  registerVerifyRoutes(app, container);
  registerAuthRoutes(app, container);
  registerLocalAuthRoutes(app, container);
  registerOidcRoutes(app, container);
  registerProjectRoutes(app, container);
  registerSpecRoutes(app, container);
  registerPipelineRoutes(app, container);
  registerPipelineOutputs(app, container);
  // إبطال الشهادات (دورة الحياة الكاملة granted/revoked)
  registerCertificateRevokeRoutes(app, container);
  registerStatsRoutes(app, container);
  registerFlywheelRoutes(app, container);
  registerFlywheelAnalyticsRoutes(app, container);
  // مقاييس المراقبة خلف جلسة المستأجر — صفحة /ops بلا توكن في المتصفح
  registerOpsMetricsRoutes(app, container);
  registerSsoRoutes(app, container);

  return app;
}
