/**
 * سجل عمليات حذف المستأجر الحي فوق PostgreSQL — السياج الذري.
 *
 * كيف يتحقق المنع داخل القاعدة لا في التطبيق: قرار beginOrResumeOperation
 * كامل (فحص القائمة/المكتمل/النسيج + الفتح) في معاملة RLS واحدة، والفهرس
 * الجزئي الفريد حيث status='in_progress' حكم التوازي النهائي — فتحان
 * متوازيان يصطدم أحدهما بالفهرس (P2002) ويرفض فلا عمليتين معاً ولا
 * نافذة سباق بين القراءة والفتح. النسيج يُخزن مُهشَّماً (sha256) حصراً.
 * الإكمال: وصل التدقيق وقلب الحالة وإيداع الإيصال في معاملة واحدة —
 * فشل أيها يبقي العملية قابلة للاستئناف بلا وصل مكرر.
 */

import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  DeletionAuditEntryInput, DeletionClaimOutcome, DeletionOperationStage,
  DeletionOperationStore,
} from "@agentbridge/memory";
import type { AuditStage, AuditTrailEntry } from "@agentbridge/shared";
import { withTenantPrisma } from "./prisma-scope.js";
import { appendAuditEntryWithTx, lastAuditEntryWithTx } from "./prisma-semantic-store.js";
import { buildChainedAuditEntry } from "./audit-chain.js";

/** ينفذ وصل التدقيق داخل معاملة قائمة ويبني الصف الموصول */
async function auditWithinTx(tx: Prisma.TransactionClient, audit: DeletionAuditEntryInput): Promise<AuditTrailEntry> {
  const tail = await lastAuditEntryWithTx(tx, audit.tenantId);
  const entry = buildChainedAuditEntry({ ...audit, stage: audit.stage as AuditStage }, tail);
  await appendAuditEntryWithTx(tx, entry);
  return entry;
}

export function createPrismaDeletionOperationStore(client: PrismaClient): DeletionOperationStore {
  return {
    async beginOrResumeOperation(tenantId, fenceHash, nowIso): Promise<DeletionClaimOutcome> {
      try {
        return await withTenantPrisma(client, tenantId, async (tx): Promise<DeletionClaimOutcome> => {
          // القرار كله هنا: القائمة أولاً ثم آخر مكتمل ثم الفتح — بلا
          // نافذة بين الفحص والفتح، والفهرس الجزئي حكم أي سباق متبقٍّ
          const active = await tx.tenantDeletionOperation.findFirst({
            where: { tenant_id: tenantId, status: "in_progress" },
            orderBy: [{ started_at: "desc" }],
          });
          if (active !== null) {
            if (active.fence_hash === fenceHash) {
              return { kind: "resumed", operationId: active.id, stage: active.stage as DeletionOperationStage };
            }
            return { kind: "inProgressConflict" };
          }
          const latestCompleted = await tx.tenantDeletionOperation.findFirst({
            where: { tenant_id: tenantId, status: "completed" },
            orderBy: [{ started_at: "desc" }],
          });
          if (latestCompleted !== null) {
            if (latestCompleted.fence_hash === fenceHash && latestCompleted.receipt_json !== null) {
              return { kind: "replay", receiptJson: latestCompleted.receipt_json };
            }
            return { kind: "fenceConflict" };
          }
          const created = await tx.tenantDeletionOperation.create({
            data: {
              id: `delop-${randomUUID()}`, tenant_id: tenantId, fence_hash: fenceHash,
              status: "in_progress", stage: "claimed",
              receipt_json: null, started_at: new Date(nowIso), completed_at: null,
            },
          });
          return { kind: "claimed", operationId: created.id };
        });
      } catch (error) {
        // الفهرس الجزئي الفريد هو حكم التوازي الأخير: منافس التزام
        // بين قراءتنا وفتحنا — التصنيف فوراً تعارض توازي لا فشل عابر
        if ((error as { code?: string })?.code === "P2002") {
          return { kind: "inProgressConflict" };
        }
        throw error;
      }
    },

    async updateStage(tenantId, operationId, stage) {
      await withTenantPrisma(client, tenantId, async (tx) => {
        const updated = await tx.tenantDeletionOperation.updateMany({
          where: { id: operationId, tenant_id: tenantId, status: "in_progress" },
          data: { stage },
        });
        if (updated.count === 0) throw new Error(`عملية حذف غير موجودة أو غير قيد التنفيذ: ${operationId}`);
      });
    },

    async completeOperation(tenantId, operationId, receiptJson, nowIso, audit) {
      await withTenantPrisma(client, tenantId, async (tx) => {
        // الوصل والإكمال في معاملة واحدة: إما الاثنان يلتزمان أو لا
        // شيء — إعادة الاستئناف بعد أي فشل تكتبهما مرة واحدة حصراً
        if (audit !== undefined) await auditWithinTx(tx, audit);
        const updated = await tx.tenantDeletionOperation.updateMany({
          where: { id: operationId, tenant_id: tenantId, status: "in_progress" },
          data: {
            status: "completed", stage: "completed",
            receipt_json: receiptJson, completed_at: new Date(nowIso),
          },
        });
        if (updated.count === 0) throw new Error(`عملية حذف غير موجودة أو غير قيد التنفيذ: ${operationId}`);
      });
    },
  };
}
