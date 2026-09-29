/**
 * اختبارات بوابة الفئات الحية وتوقيع الشهادة.
 *
 * الملزم المثبت هنا:
 * - المنح مستحيل بلا دليل فئات حية صالح مرتبط بنفس الـartifact.
 * - التوقيع Ed25519 يرفض التعديل والانتهاء والإبطال وسياسة غير متوقعة.
 * - المفتاح الخاص لا يظهر في الشهادة الموقعة إطلاقاً.
 */

import { describe, expect, it } from "vitest";
import type { GeneratedServerArtifact, LiveProbeEvidence, SecurityReport } from "@agentbridge/shared";
import { certifyArtifacts, computeArtifactsHash } from "./certificate.js";
import {
  CERTIFICATE_POLICY_VERSION,
  generateSigningKeyMaterial,
  loadSigningKeyMaterial,
  signCertificate,
  verifyCertificate,
} from "./certificate-signing.js";

const ARTIFACT: GeneratedServerArtifact = {
  files: [{ path: "src/tools.ts", contents: "export const tools = [];\n" }],
  toolNames: ["read_item"],
};

const CLEAN_REPORT: SecurityReport = {
  findings: [],
  totalChecks: 12,
  passedCount: 12,
  hasCritical: false,
  cleanlinessScore: 100,
};

/** دليل حي صالح مرتبط بالـartifact */
function liveOk(): LiveProbeEvidence {
  return {
    checksTotal: 7,
    checksPassed: 7,
    probedArtifactsHash: computeArtifactsHash(ARTIFACT),
    executedAt: "2026-08-23T00:00:00.000Z",
  };
}

function grant() {
  const result = certifyArtifacts({
    artifact: ARTIFACT,
    securityReport: CLEAN_REPORT,
    liveProbeEvidence: liveOk(),
    now: "2026-08-23T00:00:00.000Z",
  });
  if (!result.ok) throw new Error("المدخلات النظيفة يجب أن تُقبل");
  return result.value;
}

describe("بوابة الفئات الحية — فشل مغلق", () => {
  it("بلا دليل حي: درجة 100 ونظافة كاملة لا تمنح — والسبب موثق", () => {
    const result = certifyArtifacts({ artifact: ARTIFACT, securityReport: CLEAN_REPORT, now: "2026-08-23T00:00:00.000Z" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.granted).toBe(false);
    expect(result.value.notGrantedReason).toContain("فئات حية");
  });

  it("دليل لا يخص هذا الـartifact (بصمة مغايرة) يمنع المنح", () => {
    const mismatch: LiveProbeEvidence = { ...liveOk(), probedArtifactsHash: "a".repeat(64) };
    const result = certifyArtifacts({
      artifact: ARTIFACT,
      securityReport: CLEAN_REPORT,
      liveProbeEvidence: mismatch,
      now: "2026-08-23T00:00:00.000Z",
    });
    if (!result.ok) throw new Error("يجب أن تنجح المدخلات");
    expect(result.value.granted).toBe(false);
    expect(result.value.notGrantedReason).toContain("بصمة غير مطابقة");
  });

  it("فحوص حية جزئية (نجاح أقل من الإجمالي) تمنع المنح", () => {
    const partial: LiveProbeEvidence = { ...liveOk(), checksPassed: 5 };
    const result = certifyArtifacts({
      artifact: ARTIFACT,
      securityReport: CLEAN_REPORT,
      liveProbeEvidence: partial,
      now: "2026-08-23T00:00:00.000Z",
    });
    if (!result.ok) throw new Error("يجب أن تنجح المدخلات");
    expect(result.value.granted).toBe(false);
  });

  it("دليل حي صالح + نظافة كاملة + عتبة = منح", () => {
    expect(grant().granted).toBe(true);
  });
});

describe("توقيع الشهادة — Ed25519 قياسي", () => {
  it("شهادة موقعة تتحقق بمفتاحها العام ويظهر keyId وسياسة وإصدار", () => {
    const material = generateSigningKeyMaterial();
    const signed = signCertificate(grant(), { material, now: new Date("2026-08-23T00:00:00Z") });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    expect(signed.value.signature?.keyId).toBe(material.keyId);
    expect(signed.value.signature?.policyVersion).toBe(CERTIFICATE_POLICY_VERSION);
    const outcome = verifyCertificate(signed.value, { publicKey: material.publicKey });
    expect(outcome.valid).toBe(true);
  });

  it("أي تعديل لحقل موقّع (الدرجة) يكسر التوقيع", () => {
    const material = generateSigningKeyMaterial();
    const signed = signCertificate(grant(), { material });
    if (!signed.ok) throw new Error("يجب أن ينجح التوقيع");
    const tampered = { ...signed.value, finalScore: 42 };
    expect(verifyCertificate(tampered, { publicKey: material.publicKey })).toEqual({
      valid: false,
      reason: "bad-signature",
    });
  });

  it("شهادة منتهية ترفض، وغير المنتهية تمر بنفس المفتاح", () => {
    const material = generateSigningKeyMaterial();
    const signed = signCertificate(grant(), { material, now: new Date("2026-08-23T00:00:00Z"), ttlDays: 1 });
    if (!signed.ok) throw new Error("يجب أن ينجح التوقيع");
    const later = verifyCertificate(signed.value, { publicKey: material.publicKey, now: new Date("2026-08-30T00:00:00Z") });
    expect(later).toEqual({ valid: false, reason: "expired" });
    const onTime = verifyCertificate(signed.value, { publicKey: material.publicKey, now: new Date("2026-08-23T12:00:00Z") });
    expect(onTime.valid).toBe(true);
  });

  it("الإبطال: keyId مبطل أو verificationId مبطل يرفضان صراحة", () => {
    const material = generateSigningKeyMaterial();
    const signed = signCertificate(grant(), { material });
    if (!signed.ok) throw new Error("يجب أن ينجح التوقيع");
    expect(verifyCertificate(signed.value, { publicKey: material.publicKey, revokedKeyIds: [material.keyId] }).reason).toBe("revoked");
    expect(
      verifyCertificate(signed.value, { publicKey: material.publicKey, revokedVerificationIds: [signed.value.verificationId] }).reason,
    ).toBe("revoked");
  });

  it("سياسة غير متوقعة وغياب التوقيع وشهادة مرفوضة موقعة — كلها مواقف مضبوطة", () => {
    const material = generateSigningKeyMaterial();
    const signed = signCertificate(grant(), { material });
    if (!signed.ok) throw new Error("يجب أن ينجح التوقيع");
    expect(
      verifyCertificate(signed.value, { publicKey: material.publicKey, expectedPolicyVersion: "policy-9.9.9" }).reason,
    ).toBe("wrong-policy");
    expect(verifyCertificate(grant(), { publicKey: material.publicKey }).reason).toBe("malformed");
    // توقيع شهادة مرفوضة ممكن (توثيق القرار السلبي) ويبقى متسقاً داخلياً
    const rejected = certifyArtifacts({ artifact: ARTIFACT, securityReport: CLEAN_REPORT, now: "2026-08-23T00:00:00.000Z" });
    if (!rejected.ok) throw new Error("يجب أن ينجح الرفض الموثق");
    const signedRejected = signCertificate(rejected.value, { material });
    if (!signedRejected.ok) throw new Error("يجب أن يوقّع الرفض");
    expect(verifyCertificate(signedRejected.value, { publicKey: material.publicKey }).valid).toBe(true);
  });

  it("المفتاح الخاص لا يتسرب إلى الشهادة الموقعة", () => {
    const material = generateSigningKeyMaterial();
    const signed = signCertificate(grant(), { material });
    if (!signed.ok) throw new Error("يجب أن ينجح التوقيع");
    const exported = JSON.stringify(signed.value);
    // لا مسار لمادة خاصة: لا PEM ولا pkcs8 ولا حقل يذكر المفتاح الخاص
    expect(exported.includes("PRIVATE")).toBe(false);
    expect(exported.includes("pkcs8")).toBe(false);
    expect(signed.value.signature && Object.keys(signed.value.signature).join(",")).toBe(
      "algorithm,keyId,policyVersion,signedAt,expiresAt,value,revokedAtIssuance",
    );
  });
});

describe("تحميل مادة التوقيع من base64", () => {
  it("مادة صالحة تُحمل وتنتقل keyId عبر الجولة", () => {
    const material = generateSigningKeyMaterial();
    // تصدير pkcs8 base64 ثم تحميل — محاكاة مسار env المستقبلي
    const der = material.privateKey.export({ format: "der", type: "pkcs8" });
    const loaded = loadSigningKeyMaterial(Buffer.from(der).toString("base64"));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.keyId).toBe(material.keyId);
  });

  it("زبالة base64 تُرفض بخطأ صريح لا رمي مجهول", () => {
    const loaded = loadSigningKeyMaterial("not-valid-key-material!!");
    expect(loaded.ok).toBe(false);
  });
});
