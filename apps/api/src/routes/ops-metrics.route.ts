/**
 * مسار مقاييس المراقبة للجلسة — GET /ops/metrics (إغلاق عيب صفحة المراقبة).
 *
 * ماهيته: نفس سجل مقاييس Prometheus للمسار العام /metrics لكن خلف مصادقة
 * الجلسة وصلاحية analytics:read بدل توكن البيئة METRICS_TOKEN.
 * وظيفته: تمكين صفحة /ops من جلب المقاييس عبر وكيل /api بكوكيز الجلسة —
 * فلا يُرسل METRICS_TOKEN إلى المتصفح إطلاقاً ولا تصبح المقاييس عامة.
 * لماذا حصرها بالمشغّل: السجل واحد عام يجمّع طلبات جميع المستأجرين، فقراءة
 * مستأجر شبكي له تعدّ كشف نشاط غيره حتى لو كانت التسميات بلا أسماء.
 * لذلك المقاييس العامة للمشغّل في وضع التثبيت المحلي الفردي حصراً
 * (LOCAL_BOOTSTRAP=1 ومطابقة localTenantId)؛ والمستأجر الشبكي يرفض 403
 * برمز محدد تعرضه الصفحة كحالة معلومة لا كعطل — وحالة مكوّناته خاصة به
 * تبقى عبر /health/detailed المفحوص لكل مستأجر.
 * كيف: requirePermission يرفض 401 للمجهول و403 لمن لا يحمل الصلاحية،
 * ثم بوابة المشغّل ترفض 403 برمز METRICS_OPERATOR_ONLY لغير الوضع المحلي،
 * والمخرج نص Prometheus كما هو — بلا تحويل ولا إضافة.
 */

import type { FastifyInstance } from "fastify";
import { AppError } from "@agentbridge/shared";
import { requirePermission } from "../plugins/auth.plugin.js";
import { globalMetrics } from "../plugins/metrics.plugin.js";
import type { ApiContainer } from "../container.js";

export function registerOpsMetricsRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.get("/ops/metrics", async (request, reply) => {
    const context = requirePermission(request, "analytics:read");
    // بوابة المشغّل: المقاييس العامة للتثبيت المحلي الفردي حصراً —
    // مطابقة هوية مساحة العمل المحلية تمنع أي مستأجر آخر ولو محلياً
    const isOperator = container.config.localBootstrapEnabled &&
      context.tenantId === container.config.localTenantId;
    if (!isOperator) {
      throw new AppError(
        "METRICS_OPERATOR_ONLY",
        "مقاييس المنصة العامة محصورة بالمشغّل — لا تُعرض لمستأجر في النشر الشبكي",
        false,
        "warning",
      );
    }
    const body = globalMetrics.toPrometheus();
    return reply.header("content-type", "text/plain; charset=utf-8").send(body);
  });
}
