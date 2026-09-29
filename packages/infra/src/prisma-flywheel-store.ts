/**
 * محول دولاب التعلم الحي — ينفذ FlywheelStore فوق Postgres + فهرسة في L3.
 *
 * المفتاح المركب (tenant_id, id) إلزامي في كل عملية — لا بحث
 * بمعرف عالمي قبل فحص المستأجر، ولا واجهة يدوية تخفي أخطاء Prisma:
 * نستقبل PrismaClient مباشرة وكل فشل قاعدة يتصاعد كما هو للمستهلك.
 * كل عملية تمر عبر معاملة RLS تضبط app.tenant_id أولاً وتنفذ
 * العمل على TransactionClient نفسه (لا عميل الجذر داخل العمل المحمي).
 * الحفظ والاسترجاع عبر مبدئات flywheel-mappers النقية حصراً.
 */

import type { PrismaClient } from "@prisma/client";
import type { FlywheelAnalytics, FlywheelRange, FlywheelStore, Lesson, VectorStore } from "@agentbridge/memory";
import { LessonSchema, EMBEDDING_VERSION } from "@agentbridge/memory";
import { lessonFromRow, lessonToRow } from "./flywheel-mappers.js";
import { requireTenantContext, type TenantContext } from "@agentbridge/shared";
import { computeFlywheelAnalytics, embedLessonDeterministic, rangeToDays } from "./flywheel-helpers.js";
import { withTenantPrisma } from "./prisma-scope.js";

export function createPrismaFlywheelStore(
  prisma: PrismaClient,
  vectorStore: VectorStore,
): FlywheelStore {
  return {
    async saveLesson(context: TenantContext, lesson: Lesson): Promise<void> {
      const trusted = requireTenantContext(context);
      const parsed = LessonSchema.safeParse(lesson);
      if (!parsed.success) throw new Error(`درس غير صالح: ${parsed.error.message}`);
      if (parsed.data.tenantId !== trusted.tenantId) throw new Error("مستأجر الدرس لا يطابق السياق الموثوق");
      const row = lessonToRow(parsed.data);
      // upsert على المفتاح المركب داخل معاملة المستأجر — لا يغير مالك الصف
      await withTenantPrisma(prisma, trusted.tenantId, async (tx) => {
        await tx.flywheelLesson.upsert({
          where: { tenant_id_id: { tenant_id: trusted.tenantId, id: row.id } },
          create: row,
          update: {
            spec_pattern: row.spec_pattern, design_decision: row.design_decision,
            outcome: row.outcome, score: row.score, lesson_json: row.lesson_json,
          },
        });
      });
      // فهرسة في L3 عبر محول pgvector الموصّل بمعاملاته الخاصة داخل نفس نطاق المستأجر
      const text = `${parsed.data.specPattern} ${parsed.data.designDecision} ${parsed.data.outcome}`;
      await vectorStore.upsert(trusted, {
        id: row.id,
        tenantId: trusted.tenantId,
        namespace: "tool",
        vector: embedLessonDeterministic(text),
        metadata: {
          specPattern: parsed.data.specPattern.slice(0, 80),
          outcome: parsed.data.outcome,
          // provenance إلزامي: إصدار التضمين + منشأ الدرس
          embeddingVersion: EMBEDDING_VERSION,
          provenance: parsed.data.source ?? "pipeline",
        },
      });
    },

    async topK(context: TenantContext, query: string, k: number): Promise<Lesson[]> {
      const trusted = requireTenantContext(context);
      if (k <= 0 || query.length === 0) return [];
      const limit = Math.floor(k);
      // المطابقة التامة أولاً ثم الاحتواء — كلتاهما داخل معاملة المستأجر
      let rows = await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
        tx.flywheelLesson.findMany({
          where: { tenant_id: trusted.tenantId, spec_pattern: query },
          orderBy: { score: "desc" },
          take: limit,
        }));
      if (rows.length === 0) {
        const pool = await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
          tx.flywheelLesson.findMany({
            where: { tenant_id: trusted.tenantId },
            orderBy: { score: "desc" },
            take: 50,
          }));
        rows = pool.filter((row) => row.spec_pattern.includes(query) || query.includes(row.spec_pattern)).slice(0, limit);
      }
      return rows.map((row) => lessonFromRow(row));
    },

    async listRecent(context: TenantContext, limit: number): Promise<Lesson[]> {
      const trusted = requireTenantContext(context);
      if (limit <= 0) return [];
      const rows = await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
        tx.flywheelLesson.findMany({
          where: { tenant_id: trusted.tenantId },
          orderBy: { score: "desc" },
          take: Math.floor(limit),
        }));
      return rows.map((row) => lessonFromRow(row));
    },

    async deleteLesson(context: TenantContext, id: string): Promise<void> {
      const trusted = requireTenantContext(context);
      if (id.length === 0) return;
      // البحث والحذف بالمفتاح المركب داخل معاملة المستأجر — صف مستأجر آخر غير مرئي أصلاً
      const existing = await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
        tx.flywheelLesson.findUnique({ where: { tenant_id_id: { tenant_id: trusted.tenantId, id } } }));
      if (existing === null) return;
      await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
        tx.flywheelLesson.delete({ where: { tenant_id_id: { tenant_id: trusted.tenantId, id } } }));
      // حذف الفهرس في L3 جزء من العملية — فشله يفشل الطلب منعاً لبقايا عابرة
      await vectorStore.remove(trusted, "tool", id);
    },

    async analytics(context: TenantContext, range: FlywheelRange): Promise<FlywheelAnalytics> {
      const trusted = requireTenantContext(context);
      if (range !== "7d" && range !== "30d" && range !== "90d") throw new Error("range غير صالح");
      const cutoff = new Date(Date.now() - rangeToDays(range) * 86400000);
      // استعلام واحد بفلتر tenant_id + created_at >= cutoff داخل معاملة المستأجر
      const rows = await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
        tx.flywheelLesson.findMany({
          where: { tenant_id: trusted.tenantId, created_at: { gte: cutoff } },
          orderBy: { score: "desc" },
          take: 1000,
        }));
      return computeFlywheelAnalytics(rows.map((row) => lessonFromRow(row)), range, new Date());
    },
  };
}
