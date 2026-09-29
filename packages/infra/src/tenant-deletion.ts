/**
 * سير حذف المستأجر — الأنواع المشتركة وdry-run. التنفيذ المسوَّر
 * في tenant-deletion-operations.ts فوق سجل العمليات الدائم.
 *
 * السير الملزم (كل خطوة شرط لدخول التالية):
 * 1) dry-run: أرقام أثر للقراءة فقط — بلا أي كتابة.
 * 2) confirm: تأكيد مسوَّر بنسيج مُهشَّم في سجل عمليات دائم — عملية
 *    واحدة قيد التنفيذ لكل مستأجر، واستئناف، وإعادة إرسال إيدبوتنتية.
 * 3) تعطيل الوصول فوراً: إلغاء كل الاعتمادات والجلسات — مرحلة ملتزمة
 *    حتى لو فشل ما بعدها (أقوى اتجاه الفشل).
 * 4) فحص الحجز القانوني: نافذاً = رفض كامل قبل أي كتابة.
 * 5) مسح البيانات التشغيلية + الهويات اليتيمة — الإبطالات
 *    العامة وسجل التدقيق يبقيان بنيوياً (تحقق /verify ونزاعة السلسلة).
 * 6) القبر المُقلَّل: deleted_at + اسم مستعار + بلا hash اعتماد.
 * 7) وصل الحذف: ببصمة النسيج — الإكمال والوصل في ذرية واحدة.
 *
 * الاستعادة: فشل خطوة 5/6 يترك العملية قيد التنفيذ بمرحلتها المسجلة —
 * إعادة التأكيد بنفس النسيج تكمل السير؛ لا بيانات تُحذف نصف حذف.
 */

import type { TenantDeletionImpact, TenantLifecycleStore } from "@agentbridge/memory";
import type { OnboardingAuditSink } from "./tenant-onboarding.js";

export type TenantDeletionErrorCode =
  | "TENANT_NOT_FOUND"
  | "ALREADY_DELETED"
  | "LEGAL_HOLD"
  | "FENCE_REQUIRED"
  | "FENCE_MISMATCH";

export class TenantDeletionError extends Error {
  constructor(readonly code: TenantDeletionErrorCode, message: string) {
    super(message);
  }
}

export interface TenantDeletionDeps {
  readonly lifecycle: TenantLifecycleStore;
  readonly audit: OnboardingAuditSink;
}

/** تقرير dry-run — أرقام كاملة وقرار واضح بلا أي تغيير حالة */
export interface TenantDeletionDryRun {
  readonly tenantId: string;
  readonly tenantExists: boolean;
  readonly alreadyDeleted: boolean;
  readonly legalHoldUntil: string | null;
  readonly impact: TenantDeletionImpact | null;
  readonly revocationsKeptVerificationIds: readonly string[];
  readonly verdict: "READY" | "ALREADY_DELETED" | "LEGAL_HOLD" | "NOT_FOUND";
}

/** وصل الحذف النهائي — بصمة النسيج لا الخام، وأرقام لكل مجموعة */
export interface TenantDeletionReceipt {
  readonly tenantId: string;
  readonly completedAt: string;
  readonly impact: TenantDeletionImpact;
  /** بصمة sha256 للسياج — النسيج الخام لا يُخزن في أي مكان */
  readonly fenceHash: string;
  readonly auditCorrelationId: string;
}

/** يحسب dry-run — قراءة خالصة، الخطوة 1 من السير */
export async function dryRunTenantDeletion(deps: TenantDeletionDeps, tenantId: string): Promise<TenantDeletionDryRun> {
  const state = await deps.lifecycle.getTenantLifecycleState(tenantId);
  if (state === null) {
    return { tenantId, tenantExists: false, alreadyDeleted: false, legalHoldUntil: null, impact: null, revocationsKeptVerificationIds: [], verdict: "NOT_FOUND" };
  }
  if (state.deletedAt !== undefined) {
    return { tenantId, tenantExists: true, alreadyDeleted: true, legalHoldUntil: state.legalHoldUntil ?? null, impact: null, revocationsKeptVerificationIds: [], verdict: "ALREADY_DELETED" };
  }
  const holdUntil = state.legalHoldUntil ?? null;
  if (holdUntil !== null && Date.parse(holdUntil) > Date.now()) {
    return { tenantId, tenantExists: true, alreadyDeleted: false, legalHoldUntil: holdUntil, impact: null, revocationsKeptVerificationIds: [], verdict: "LEGAL_HOLD" };
  }
  const semantic = await deps.lifecycle.countSemanticImpact(tenantId);
  const auth = await deps.lifecycle.countAuthImpact(tenantId);
  const impact: TenantDeletionImpact = { ...semantic, ...auth };
  return {
    tenantId, tenantExists: true, alreadyDeleted: false, legalHoldUntil: holdUntil,
    impact, revocationsKeptVerificationIds: await deps.lifecycle.listRevocationVerificationIds(tenantId),
    verdict: "READY",
  };
}
