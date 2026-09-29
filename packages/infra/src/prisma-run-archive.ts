/**
 * أرشيف حالة التشغيل الحي — تنفيذ RunArchiveStore فوق Postgres.
 *
 * ينفذ شرط التصاعد في SQL نفسها (CAS): التحديث يتقدم فقط لجيل أعلى أو نفس
 * الجيل بـfence أعلى — فحص الكتابة القديمة يقع في قاعدة البيانات لا في
 * العملية، فلا سباق بين عمليتين. كل عملية عبر معاملة RLS واحدة تضبط
 * الجدول من migration 20260918000000_run_state_archives (forward-only).
 */

import type { PrismaClient } from "@prisma/client";
import { ok, type Result } from "@agentbridge/shared";
import type { RunArchiveRecord, RunArchiveStore } from "@agentbridge/memory";
import { staleArchiveError } from "@agentbridge/memory";
import { withTenantPrisma } from "./prisma-scope.js";

export function createPrismaRunArchiveStore(prisma: PrismaClient): RunArchiveStore {
  return {
    async archive({ tenantId, runId, snapshotJson, generation, fence, archivedAt }) {
      return withTenantPrisma(prisma, tenantId, async (tx): Promise<Result<void>> => {
        // upsert بشرط التصاعد: create دائماً مقبول؛ update بشرط ألا يكون الرائداً قديماً
        const updated = await tx.runStateArchive.updateMany({
          where: {
            tenant_id: tenantId,
            run_id: runId,
            OR: [
              { generation: { lt: generation } },
              { generation: generation, fence: { lt: fence } },
            ],
          },
          data: { snapshot_json: snapshotJson, generation, fence, archived_at: archivedAt ?? new Date() },
        });
        if (updated.count === 0) {
          try {
            const created = await tx.runStateArchive.createMany({
              data: [{ tenant_id: tenantId, run_id: runId, snapshot_json: snapshotJson, generation, fence, ...(archivedAt !== undefined ? { archived_at: archivedAt } : {}) }],
            });
            if (created.count === 0) {
              // الصف موجود ورائد أو مساوٍ — كتابة قديمة مرفوضة من قاعدة البيانات
              return { ok: false, error: staleArchiveError(`أرشفة (generation ${generation}/fence ${fence}) لم تفوق المخزن — رفض SQL`) };
            }
          } catch (error) {
            // P2002 = تعارض المفتاح المركب: صف أحدث سابقنا في اللحظة نفسها —
            // كتابة قديمة/متسابقة مرفوضة من قيد القاعدة لا من فحص العملية
            if ((error as { code?: string }).code === "P2002") {
              return { ok: false, error: staleArchiveError(`أرشفة (generation ${generation}/fence ${fence}) خسرت سباق التصاعد — قيد القاعدة رفضها`) };
            }
            throw error;
          }
        }
        return ok(undefined);
      });
    },

    async latest(tenantId, runId): Promise<RunArchiveRecord | null> {
      return withTenantPrisma(prisma, tenantId, async (tx): Promise<RunArchiveRecord | null> => {
        const row = await tx.runStateArchive.findUnique({
          where: { tenant_id_run_id: { tenant_id: tenantId, run_id: runId } },
        });
        if (row === null) return null;
        return {
          snapshotJson: row.snapshot_json,
          generation: row.generation,
          fence: Number(row.fence),
          archivedAt: row.archived_at.toISOString(),
        };
      });
    },

    async purgeExpiredBefore(tenantId: string, cutoffIso: string): Promise<number> {
      // الجدول تحت FORCE RLS — المسح عبر دور ab_app المقيد داخل نطاق المستأجر
      // حصراً؛ لا مسح شامل بلا سياق
      return withTenantPrisma(prisma, tenantId, async (tx) =>
        (await tx.runStateArchive.deleteMany({ where: { tenant_id: tenantId, archived_at: { lt: new Date(cutoffIso) } } })).count);
    },
  };
}
