/**
 * حل مفاتيح التوقيع الثلاثة من إعداد الخادم.
 *
 * ماهيته: نقطة واحدة تحمّل ORCH_SNAPSHOT_PRIVATE_KEY و
 * CERT_SIGNING_PRIVATE_KEY وHITL_SIGNING_PRIVATE_KEY وتبني حلقات
 * التحقق (الدوران). فشل التحميل يرمي قبل الإقلاع — لا مفتاح بديل صامت
 * يخدع بمصداقية توقيع غير موجودة، ولا any ولا تعطيل أنواع.
 * كيف: محمّلات الحزم المعنية (orchestrator/evaluator) هي فاحص الصيغة
 * النهائي؛ هنا فقط التنسيق والجمع بلا منطق توقيع مكرر.
 */

import type { AppConfig } from "@agentbridge/infra";
import {
  loadSnapshotSigningMaterial,
  loadSnapshotVerifyKey,
  type SnapshotKeyRing,
  type SnapshotSigningMaterial,
} from "@agentbridge/orchestrator";
import {
  loadSigningKeyMaterial,
  type SigningKeyMaterial,
} from "@agentbridge/evaluator";
import type { LlmRequest } from "@agentbridge/llm";
import { loadHitlSigningMaterial, type HitlSigningMaterial } from "../run-service/hitl-approval.js";

export interface ResolvedSigning {
  /** مادة توقيع snapshots — غياب إعدادها يعني عابراً (تطوير فقط، موثق) */
  readonly snapshot?: SnapshotSigningMaterial;
  /** مفاتيح عامة سابقة للتحقق قراءةً فقط (نافذة الدوران) */
  readonly snapshotVerifyKeys: SnapshotKeyRing;
  /** مادة توقيع الشهادة — غيابها يترك الشهادات غير موقعة (بوابات المنح قائمة) */
  readonly certificate?: SigningKeyMaterial;
  /**
   * حلقة تحقق شهادات الدوران (SPKI عامة سابقة) — /verify
   * يتحقق بتوقيع أي مفتاح معروف بنافذته، والإصدار يبقى بالمفتاح الحالي.
   */
  readonly certificateVerifyKeys: ReadonlyMap<string, import("node:crypto").KeyObject>;
  /** keyIds ملغاة من الإعداد — توقيعها = سبب revoked موثق */
  readonly certificateRevokedKeyIds: readonly string[];
  /** مادة توقيع تذاكر HITL — undefined يعني توليداً عابراً في الحاوية (تطوير فقط) */
  readonly hitl?: HitlSigningMaterial;
}

/** يحمّل الثلاثية من الإعداد — أي مفتاح معلن غير صالح يرفض الإقلاع برمي صريح */
export function resolveSigningMaterials(config: AppConfig): ResolvedSigning {
  let snapshot: SnapshotSigningMaterial | undefined;
  if (config.orchSnapshotPrivateKey !== undefined) {
    const loaded = loadSnapshotSigningMaterial(config.orchSnapshotPrivateKey);
    if (!loaded.ok) throw loaded.error;
    snapshot = loaded.value;
  }
  const verifyEntries: Array<[string, KeyObjectLike]> = [];
  for (const spki of config.orchSnapshotVerifyPublicKeys) {
    const key = loadSnapshotVerifyKey(spki);
    if (!key.ok) throw key.error;
    verifyEntries.push([key.value.keyId, key.value.publicKey]);
  }
  let certificate: SigningKeyMaterial | undefined;
  if (config.certSigningPrivateKey !== undefined) {
    const loaded = loadSigningKeyMaterial(config.certSigningPrivateKey);
    if (!loaded.ok) throw loaded.error;
    certificate = loaded.value;
  }
  // حلقة تحقق الشهادات من الإعداد — أي مفتاح مخالف يرفض الإقلاع
  const certVerifyEntries: Array<[string, import("node:crypto").KeyObject]> = [];
  for (const spki of config.certSigningVerifyPublicKeys) {
    const key = loadSnapshotVerifyKey(spki);
    if (!key.ok) throw key.error;
    certVerifyEntries.push([key.value.keyId, key.value.publicKey]);
  }
  let hitl: HitlSigningMaterial | undefined;
  if (config.hitlSigningPrivateKey !== undefined) {
    const loaded = loadHitlSigningMaterial(config.hitlSigningPrivateKey);
    if (!loaded.ok) throw loaded.error;
    hitl = loaded.value;
  }
  return {
    ...(snapshot !== undefined ? { snapshot } : {}),
    snapshotVerifyKeys: new Map(verifyEntries),
    ...(certificate !== undefined ? { certificate } : {}),
    certificateVerifyKeys: new Map(certVerifyEntries),
    certificateRevokedKeyIds: config.certSigningRevokedKeyIds,
    ...(hitl !== undefined ? { hitl } : {}),
  };
}

type KeyObjectLike = import("node:crypto").KeyObject;

/**
 * سياسة سقف الحجز التقني: تقدير حتمي بالأحرف من حدود الطلب نفسها
 * (system + messages) بمعاملات إعداد معلنة. هذه ليست سياسة التسعير
 * التجارية — قرار التسعير النهائي قرار أعمال منفصل؛ هنا ضابط موارد
 * محافظ يمنع النداء غير المحجوز أصلاً.
 */
export function ceilingUsdOfFactory(config: AppConfig): (request: LlmRequest) => number {
  return (request) => {
    const chars = request.system.length + JSON.stringify(request.messages).length;
    const estimate = (chars / 1000) * config.llmReservationPriceUsdPer1kChars * config.llmReservationCeilingFactor;
    return Math.max(config.llmReservationMinUsd, Math.round(estimate * 10_000) / 10_000);
  };
}
