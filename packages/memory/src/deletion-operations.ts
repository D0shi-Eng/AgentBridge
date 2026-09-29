/**
 * سجل عمليات حذف المستأجر الدائم — السياج الفعلي بدل الفحص
 * العابر. صف واحد على الأقل بحالة in_progress لكل مستأجر، ونسيج
 * (fence) مُهشَّم لا يُخزن خاماً. الإكمال مع وصل التدقيق بلا تكرار:
 * إعادة الإرسال بنفس النسيج تعيد الإيصال المخزن بلا وصل جديد.
 *
 * القرار كله في عملية واحدة (beginOrResumeOperation): فتح، استئناف،
 * إعادة إرسال، أو رفض — بلا نافذة سباق بين قراءة الحالة والفتح. في
 * الحي: الفهرس الجزئي الفريد حيث status='in_progress' حكم التوازي
 * النهائي داخل القاعدة.
 */

import { randomUUID } from "node:crypto";

/** حالة العملية: قيد التنفيذ أو مكتملة — لا حالات وسيطة دائمة */
export type DeletionOperationStatus = "in_progress" | "completed";

/** مرحلة التنفيذ المسجلة — تمكّن الاستئناف من الموضع الصحيح بعد فشل */
export type DeletionOperationStage = "claimed" | "revoked" | "purged" | "tombstoned" | "completed";

/** صف سجل عملية الحذف — النسيج مُهشَّم حصراً والإيصال نص JSON */
export interface TenantDeletionOperationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly fenceHash: string;
  readonly status: DeletionOperationStatus;
  readonly stage: DeletionOperationStage;
  readonly receiptJson: string | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
}

/** نتيجة بدء/استئناف العملية — القرار الحتمي الكامل بلا نافذة سباق */
export type DeletionClaimOutcome =
  | { readonly kind: "claimed"; readonly operationId: string }
  /** عملية قائمة بنفس النسيج — استئناف من مرحلتها المسجلة */
  | { readonly kind: "resumed"; readonly operationId: string; readonly stage: DeletionOperationStage }
  /** عملية مكتملة بنفس النسيج — أعِد الإيصال المخزن بلا تنفيذ */
  | { readonly kind: "replay"; readonly receiptJson: string }
  /** عملية مكتملة/قائمة بنسيج مختلف — تعارض صريح */
  | { readonly kind: "fenceConflict" }
  /** عملية قائمة بنسيج مختلف قيد التنفيذ — توازي مرفوض */
  | { readonly kind: "inProgressConflict" };

/** مدخل وصل التدقيق المرتبط بالإكمال — بنيوياً مطابق لمستقبل HashChainAuditLog */
export interface DeletionAuditEntryInput {
  readonly tenantId: string;
  readonly runId: string;
  readonly stage: string;
  readonly decision: string;
  readonly abstractedPayload: string;
  readonly at: string;
}

/** منفذ سجل عمليات الحذف — العقد الموحد بين الذاكرة وPostgreSQL */
export interface DeletionOperationStore {
  /**
   * القرار الذري: فتح عملية جديدة، استئناف قائمة بنفس النسيج، إعادة
   * إرسال مكتملة بنفس النسيج، أو رفض صريح — كل الحالات تُفحص في
   * المعاملة نفسها التي تفتح فيها العملية (في الحي) فلا نافذة سباق.
   */
  beginOrResumeOperation(tenantId: string, fenceHash: string, nowIso: string): Promise<DeletionClaimOutcome>;
  /** تثبيت تقدم المرحلة — يستأنف منها الاستئناف لاحقاً */
  updateStage(tenantId: string, operationId: string, stage: DeletionOperationStage): Promise<void>;
  /**
   * الإكمال: الإيصال يُخزن والحالة تُقلب completed؛ مع مدخل تدقيق
   * يُكتب الوصل والإكمال معاً بلا نافذة بينهما (الحي: معاملة واحدة).
   */
  completeOperation(
    tenantId: string,
    operationId: string,
    receiptJson: string,
    nowIso: string,
    audit?: DeletionAuditEntryInput,
  ): Promise<void>;
}

/** تنفيذ داخل الذاكرة — عملية واحدة قيد التنفيذ كحد أقصى لكل مستأجر */
export function createInMemoryDeletionOperationStore(
  auditSink?: { record(input: DeletionAuditEntryInput): Promise<unknown> },
): DeletionOperationStore {
  const operations = new Map<string, TenantDeletionOperationRecord>();
  return {
    async beginOrResumeOperation(tenantId, fenceHash, nowIso) {
      const active = [...operations.values()].find((r) => r.tenantId === tenantId && r.status === "in_progress");
      if (active !== undefined) {
        if (active.fenceHash === fenceHash) {
          return { kind: "resumed", operationId: active.id, stage: active.stage };
        }
        return { kind: "inProgressConflict" };
      }
      const latestCompleted = [...operations.values()]
        .filter((r) => r.tenantId === tenantId && r.status === "completed")
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))[0];
      if (latestCompleted !== undefined) {
        if (latestCompleted.fenceHash === fenceHash && latestCompleted.receiptJson !== null) {
          return { kind: "replay", receiptJson: latestCompleted.receiptJson };
        }
        return { kind: "fenceConflict" };
      }
      const record: TenantDeletionOperationRecord = {
        id: `delop-${randomUUID()}`,
        tenantId, fenceHash, status: "in_progress", stage: "claimed",
        receiptJson: null, startedAt: nowIso, completedAt: null,
      };
      operations.set(record.id, record);
      return { kind: "claimed", operationId: record.id };
    },

    async updateStage(tenantId, operationId, stage) {
      const record = operations.get(operationId);
      if (record === undefined || record.tenantId !== tenantId) {
        throw new Error(`عملية حذف غير موجودة: ${operationId}`);
      }
      operations.set(operationId, { ...record, stage });
    },

    async completeOperation(tenantId, operationId, receiptJson, nowIso, audit) {
      const record = operations.get(operationId);
      if (record === undefined || record.tenantId !== tenantId) {
        throw new Error(`عملية حذف غير موجودة: ${operationId}`);
      }
      // الوصل أولاً ثم قلب الحالة — فشل الوصل يبقي العملية قابلة للاستئناف
      if (audit !== undefined && auditSink !== undefined) await auditSink.record(audit);
      operations.set(operationId, { ...record, status: "completed", stage: "completed", receiptJson, completedAt: nowIso });
    },
  };
}
