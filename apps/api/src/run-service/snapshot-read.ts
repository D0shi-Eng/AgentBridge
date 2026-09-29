/**
 * قارئ snapshot الموحد للمسارات القرائية (أدوات/artifact/شهادة/HITL).
 *
 * ماهيته: نقطة واحدة تفهم شكلي snapshot — المظروف الموقّع v2 والإصدار
 * القديم v1 — بدل تكرار التحليل في كل مسار قراءة.
 * القرار الأمني: المسار القرائي يتحقق من **التوقيع والانتهاء والسياسة**
 * بمفتاح العملية (لا ثقة بمحتوى غير موقّع) ويترك مطابقة هوية الاستئناف
 * لمسار resume الذي يملأ runId/tenantId المتوقعة إلزامياً.
 * إصدار v1 legacy يعاد كما هو (readOnly للسجلات القديمة) — لا يصلح
 * استئنافاً أصلاً (يحجره المحرك).
 */

import { classifySnapshot, defaultProcessSigningMaterial, verifySignedSnapshot, type SnapshotKeyRing, type SnapshotSigningMaterial } from "@agentbridge/orchestrator";
import { PipelineContext, type PipelineData } from "@agentbridge/orchestrator";

/**
 * يبني حلقة التحقق من مادة الإعداد ومفاتيح الدوران — يستدعيه من
 * يملك الإعداد (الحاوية) ليمرر الحلقة للمسارات القرائية؛ بلا إعداد يبقى
 * مفتاح العملية العابر (تطوير/اختبار — موثق لا مخفي).
 */
export function snapshotKeyRingOf(
  signing?: SnapshotSigningMaterial,
  verifyKeys?: SnapshotKeyRing,
): SnapshotKeyRing {
  if (signing !== undefined) {
    return new Map([...(verifyKeys ?? []), [signing.keyId, signing.publicKey]]);
  }
  const material = defaultProcessSigningMaterial();
  return new Map([[material.keyId, material.publicKey]]);
}

/** نتيجة القراءة — حقول موحدة بغض النظر عن إصدار المظروف */
export interface SnapshotView {
  readonly runId: string;
  readonly tenantId: string;
  readonly statuses: Record<string, string>;
  readonly repairCyclesUsed: number;
  readonly data: PipelineData;
  readonly legacy: boolean;
}

/** يقرأ snapshot (v2 موقعة أو v1 قديمة) ويعيد حقولها — null عند الفساد.
 * keyRing: حلقة تحقق الإعداد — غيابها يبقي مفتاح العملية العابر. */
export function readSnapshotView(snapshotJson: string, keyRing?: SnapshotKeyRing): SnapshotView | null {
  if (classifySnapshot(snapshotJson) === "signed") {
    const ring = keyRing ?? snapshotKeyRingOf();
    const verified = verifySignedSnapshot(
      snapshotJson,
      ring,
      { policyVersion: undefined },
    );
    if (!verified.ok) return null;
    const { payload } = verified.value;
    return {
      runId: payload.runId,
      tenantId: payload.tenantId,
      statuses: payload.statuses,
      repairCyclesUsed: payload.repairCyclesUsed,
      data: payload.data as PipelineData,
      legacy: false,
    };
  }
  const legacy = PipelineContext.fromSnapshot(snapshotJson);
  if (!legacy.ok) return null;
  return {
    runId: legacy.value.runId,
    tenantId: legacy.value.tenantId,
    statuses: Object.fromEntries(legacy.value.statuses),
    repairCyclesUsed: legacy.value.repairCyclesUsed,
    data: legacy.value.data,
    legacy: true,
  };
}
