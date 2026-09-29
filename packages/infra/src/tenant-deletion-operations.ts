/**
 * سير حذف المستأجر المسوَّر — السياج الفعلي فوق سجل
 * العمليات الدائم لا فحصاً عابراً.
 *
 * العقود الملزمة:
 * - عملية واحدة قيد التنفيذ كحد أقصى لكل مستأجر — فتح ثانية متزامنة
 *   يرفض بDELETION_IN_PROGRESS من القاعدة نفسها (فهرس جزئي فريد).
 * - نفس النسيج يستأنف العملية؛ نسيج مختلف أثناء عملية قائمة أو بعد
 *   اكتمال يرفض بFENCE_MISMATCH تعارضاً صريحاً.
 * - إعادة الإرسال بنفس النسيج بعد الاكتمال تعيد الإيصال المخزن بنجاح
 *   وبلا أي حدث تدقيق إضافي.
 * - النسيج لا يُخزن خاماً — hash sha256 حصراً في السجل وفي الوصل.
 * - فشل أي مرحلة يبقي العملية قيد التنفيذ بمرحلتها المسجلة — الاستئناف
 *   بنفس النسيج يكمل من الموضع الصحيح، والوصل النهائي يصدر مرة واحدة
 *   (الإكمال والوصل في ذرية واحدة في الحي).
 * - القبر مُقلَّل البيانات والهويات اليتيمة تُحذف بمرحلة المسح.
 */

import type { TenantDeletionImpact, TenantLifecycleStore } from "@agentbridge/memory";
import { sha256Hex } from "./crypto.js";
import { TenantDeletionError, type TenantDeletionErrorCode, type TenantDeletionReceipt } from "./tenant-deletion.js";

/** رموز أخطاء السير المسوَّر — يضيف تعارض التوازي إلى رموز السير الأصلية */
export type DeletionFlowErrorCode = TenantDeletionErrorCode | "DELETION_IN_PROGRESS";

export class DeletionFlowError extends Error {
  constructor(readonly code: DeletionFlowErrorCode, message: string) {
    super(message);
  }
}

/** deps السير المسوَّر — سجل العمليات هو حكم السياج لا فحص تطبيقي */
export interface TenantDeletionFlowDeps {
  readonly lifecycle: TenantLifecycleStore;
  readonly operations: import("@agentbridge/memory").DeletionOperationStore;
}

/** بصمة النسيج — الوحيدة المخزنة والوثيقة في الوصل؛ الخام لا يُحفظ */
export function fenceHashOf(fence: string): string {
  return sha256Hex(`agentbridge:fence:v1:${fence}`);
}

/** نتيجة التأكيد: إيصال الإكمال مع وسم الإعادة الإيدبوتنتية */
export interface FencedDeletionResult {
  readonly receipt: TenantDeletionReceipt;
  /** true = إعادة إرسال بنفس النسيج أعادت الإيصال المخزن بلا تنفيذ */
  readonly replayed: boolean;
}

/** نمط السياج: 16–128 محرفاً من أحرف بلا غموض — يوثق بهشه في الوصل */
const FENCE_PATTERN = /^[A-Za-z0-9_.:-]{16,128}$/u;

/**
 * تأكيد الحذف المسوَّر: فتح/استئناف عملية من السجل ثم تنفيذ المراحل
 * المتبقية (تعطيل ← مسح ← قبر ← إكمال+وصل ذري). الإيصال يُخزن في السجل
 * فتعيد الإرسالات اللاحقة بنفس النسيج نجاحاً بلا تنفيذ ولا وصل.
 */
export async function confirmTenantDeletionFenced(
  deps: TenantDeletionFlowDeps,
  tenantId: string,
  fence: string,
  confirmationToken: string,
  nowIso: string,
): Promise<FencedDeletionResult> {
  if (!FENCE_PATTERN.test(fence)) {
    throw new TenantDeletionError("FENCE_REQUIRED", `مفتاح السياج إلزامي (16–128 محرفاً من A-Za-z0-9_.:-): طوله ${fence.length}`);
  }
  if (confirmationToken !== tenantId) {
    throw new TenantDeletionError("FENCE_MISMATCH", `رمز التأكيد لا يطابق معرف المستأجر — أعد كتابة "${tenantId}" حرفياً لمنع الحذف الخاطئ`);
  }
  const fenceHash = fenceHashOf(fence);

  // فحوص ما قبل القرار — الشروط المسبقة قبل لمس سجل العمليات
  const state = await deps.lifecycle.getTenantLifecycleState(tenantId);
  if (state === null) throw new TenantDeletionError("TENANT_NOT_FOUND", `المستأجر غير موجود: ${tenantId}`);
  const holdUntil = state.legalHoldUntil ?? null;
  if (holdUntil !== null && Date.parse(holdUntil) > Date.parse(nowIso)) {
    throw new TenantDeletionError("LEGAL_HOLD", `حذف ${tenantId} محجوز قانونياً حتى ${holdUntil} — ارفع الحجز أولاً بقرار موثق`);
  }

  // القرار الذري: فتح/استئناف/إعادة إرسال/رفض — بلا نافذة سباق
  const outcome = await deps.operations.beginOrResumeOperation(tenantId, fenceHash, nowIso);
  if (outcome.kind === "replay") {
    return { receipt: JSON.parse(outcome.receiptJson) as TenantDeletionReceipt, replayed: true };
  }
  if (outcome.kind === "fenceConflict") {
    throw new DeletionFlowError("FENCE_MISMATCH", "المستأجر مُدقّر سابقاً بعملية نسيجها مختلف — تعارض صريح لا إعادة حذف");
  }
  if (outcome.kind === "inProgressConflict") {
    throw new DeletionFlowError("DELETION_IN_PROGRESS", `عملية حذف متزامنة قائمة للمستأجر ${tenantId} — رفضها سياج القاعدة`);
  }
  const operationId = outcome.operationId;
  const stage = outcome.kind === "resumed" ? outcome.stage : "claimed";

  // المراحل المتبقية — كلها إيدبوتنتية فالاستئناف آمن من أي موضع؛
  // أرقام المسح تلتقط عند تنفيذها فعلاً وصفر عند الاستئناف المتخطي
  let purged = { projects: 0, specs: 0, pipelines: 0, certificates: 0, artifacts: 0 };
  let identitiesDeleted = 0;
  if (stage === "claimed") {
    await deps.lifecycle.revokeTenantAuth(tenantId, nowIso);
    await deps.operations.updateStage(tenantId, operationId, "revoked");
  }
  if (stage === "claimed" || stage === "revoked") {
    purged = await deps.lifecycle.purgeSemanticData(tenantId);
    // الجانب الأمني للتشغيل (جلسات/معاملات دخول/عضويات/SSO) يمسح أولاً
    await deps.lifecycle.purgeTenantAuthData(tenantId);
    // هويات المالك اليتيمة تُحذف؛ المشتركة مع مستأجر حي تبقى
    identitiesDeleted = await deps.lifecycle.deleteOrphanExternalIdentities(tenantId);
    await deps.lifecycle.deleteTenantCredentials(tenantId);
    await deps.operations.updateStage(tenantId, operationId, "purged");
  }
  if (stage === "claimed" || stage === "revoked" || stage === "purged") {
    // القبر مُقلَّل البيانات — والاستئناف بعد قبر قائم يتخطاه بأمان
    const state = await deps.lifecycle.getTenantLifecycleState(tenantId);
    if (state !== null && state.deletedAt === undefined) {
      await deps.lifecycle.tombstoneTenant(tenantId, nowIso);
    }
    await deps.operations.updateStage(tenantId, operationId, "tombstoned");
  }

  // أرقام الأثر النهائية: ما مُسح في هذا التنفيذ + الباقي عمداً (إبطالات عامة + تدقيق)
  const remaining = await deps.lifecycle.countSemanticImpact(tenantId);
  const auth = await deps.lifecycle.countAuthImpact(tenantId);
  const impact: TenantDeletionImpact = {
    ...purged,
    revocationsKept: remaining.revocationsKept,
    auditKept: remaining.auditKept,
    ...auth,
    externalIdentitiesDeleted: identitiesDeleted,
  };
  const receipt: TenantDeletionReceipt = {
    tenantId,
    completedAt: nowIso,
    impact,
    fenceHash,
    auditCorrelationId: `tenant-deletion:${fenceHash}`,
  };
  // الإكمال والوصل معاً: الحي معاملة واحدة فلا وصل مكرر ولا إكمال بلا وصل
  await deps.operations.completeOperation(
    tenantId, operationId, JSON.stringify(receipt), nowIso,
    {
      tenantId,
      runId: receipt.auditCorrelationId,
      stage: "tenant_deletion",
      decision: "completed",
      abstractedPayload: JSON.stringify({
        event: "tenant.deletion.completed",
        fenceHash, impact,
        remaining: ["audit_log", "certificate_revocations", "tombstone"],
      }),
      at: nowIso,
    },
  );
  return { receipt, replayed: false };
}
