/**
 * مسار دولاب التعلم L4 — واجهة إدارة الدروس (وثيقة memory.md §L4).
 *
 * ماهيته: ثلاث عمليات خلف مصادقة المستأجر مع عزل بنيوي:
 *   GET /flywheel/lessons?query=&k= — بحث topK داخل مستأجر واحد
 *   GET /flywheel/lessons — قائمة أحدث 50 بترتيب score تنازلياً
 *   DELETE /flywheel/lessons/:id — حذف مع إزالة فهرس L3
 * وظيفته: تمكين اللوحة من عرض وإدارة الدروس بلا تسريب بين المستأجرين.
 * كيف: Zod للاستعلام + requireTenant + استدعاء FlywheelStore العام.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@agentbridge/shared";
import { requirePermission } from "../plugins/auth.plugin.js";
import type { ApiContainer } from "../container.js";

// مخطط الاستعلام — query اختياري وk بين 1 و50
const LessonsQuerySchema = z.object({
  query: z.string().max(500).optional(),
  k: z
    .string()
    .optional()
    .transform((value) => (value === undefined ? undefined : Number.parseInt(value, 10)))
    .refine((value) => value === undefined || (Number.isInteger(value) && value >= 1 && value <= 50), {
      message: "k يجب أن يكون بين 1 و 50",
    }),
});

export function registerFlywheelRoutes(app: FastifyInstance, container: ApiContainer): void {
  // GET /flywheel/lessons — قائمة أو بحث
  app.get("/flywheel/lessons", async (request) => {
    const context = requirePermission(request, "flywheel:read");
    const rawQuery = request.query as Record<string, unknown>;
    // تحويل query الجام للتطابق مع Zod (يحتاج strings)
    const shaped: Record<string, string | undefined> = {};
    if (typeof rawQuery.query === "string") shaped.query = rawQuery.query;
    if (typeof rawQuery.k === "string") shaped.k = rawQuery.k;
    if (typeof rawQuery.query === "string" && rawQuery.query.length === 0) shaped.query = undefined;
    const parsed = LessonsQuerySchema.safeParse(shaped);
    if (!parsed.success) throw new AppError("INVALID_INPUT", parsed.error.message);
    const queryValue = parsed.data.query;
    const kValue = parsed.data.k ?? 3;
    // إن وجد استعلام بحثي ⇒ topK داخل المستأجر، وإلا قائمة حديثة
    if (queryValue !== undefined && queryValue.length > 0) {
      const hits = await container.flywheel.topK(context, queryValue, kValue);
      return { lessons: hits };
    }
    const recent = await container.flywheel.listRecent(context, 50);
    return { lessons: recent };
  });

  // DELETE /flywheel/lessons/:id — حذف مع عزل مستأجر
  app.delete("/flywheel/lessons/:id", async (request, reply) => {
    const context = requirePermission(request, "flywheel:write");
    const { id } = request.params as { id: string };
    if (typeof id !== "string" || id.length === 0 || id.length > 200) {
      throw new AppError("INVALID_INPUT", "معرف الدرس غير صالح");
    }
    await container.flywheel.deleteLesson(context, id);
    return reply.code(200).send({ deleted: true, id });
  });
}
