/**
 * مسار تحليلات دولاب التعلم L4 — GET /flywheel/analytics (وثيقة memory.md §L4 التحليلات).
 *
 * ماهيته: يحسب إجمالي الدروس ومتوسط الدرجة ومعدل النجاح وهيستوغرام 5 فئات
 * وأعلى الأنماط تكراراً واتجاه زمني — كله من flywheel_lessons حصراً عبر row-mappers.
 * وظيفته: تزويد لوحة التحليلات بأرقام معزولة لكل مستأجر بفلتر زمني 7/30/90 يوم.
 * كيف: Zod للاستعلام (range enum فقط) + requireTenant + استدعاء flywheel.analytics الحتمي.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@agentbridge/shared";
import { requirePermission } from "../plugins/auth.plugin.js";
import type { ApiContainer } from "../container.js";

// مخطط الاستعلام — range enum فقط، افتراضي 7d إن غاب
const AnalyticsQuerySchema = z.object({
  range: z.enum(["7d", "30d", "90d"]).optional().default("7d"),
});

export function registerFlywheelAnalyticsRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.get("/flywheel/analytics", async (request) => {
    const context = requirePermission(request, "analytics:read");
    const rawQuery = request.query as Record<string, unknown>;
    const shaped: Record<string, unknown> = {};
    if (typeof rawQuery.range === "string") shaped.range = rawQuery.range;
    else if (rawQuery.range !== undefined) shaped.range = String(rawQuery.range);
    const parsed = AnalyticsQuerySchema.safeParse(shaped);
    if (!parsed.success) throw new AppError("INVALID_INPUT", `range غير صالح — المسموح 7d|30d|90d: ${parsed.error.message}`);
    // إن أرسل العميل قيمة غير enum صريحة ومرت عبر default؟ نتحقق يدوياً
    if (rawQuery.range !== undefined && typeof rawQuery.range === "string" && !["7d", "30d", "90d"].includes(rawQuery.range)) {
      throw new AppError("INVALID_INPUT", "range يجب أن يكون 7d أو 30d أو 90d");
    }
    const range = parsed.data.range;
    const result = await container.flywheel.analytics(context, range);
    return result;
  });
}
