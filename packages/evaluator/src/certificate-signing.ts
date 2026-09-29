/**
 * توقيع الشهادة — توقيع قياسي Ed25519 + انتهاء + إبطال + keyId.
 *
 * حدود الثقة والقرارات الأمنية:
 * - primitives قياسية فقط (node:crypto) — لا خوارزمية مخصصة، لا مكتبة جديدة.
 * - المفتاح الخاص لا يدخل الشهادة ولا الـartifact إطلاقاً؛ التحقق العام
 *   يستلزم المفتاح العام فقط (مشتق من نفس المادة بقناة منفصلة).
 * - ما يثبته التوقيع: منشأ الشهادة وسلامتها من التعديل. ما لا يثبته:
 *   أن الخادم آمن — أمن الخادم دليله الفئات الحية والفحوص لا التوقيع.
 * - الإبطال خارج التوقيع عمداً: قائمة إبطال تُفحص وقت التحقق، لأن
 *   تعديل حقل revocation داخل payload الموقعة يكسر التوقيع نفسه.
 * - الخرائط الموقعة canonical: حقول الشهادة بترتيب ثابت بدون كتلة التوقيع.
 */

import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { AppError, CertificateSchema, err, ok, type Certificate, type Result } from "@agentbridge/shared";

/** إصدار سياسة الشهادة الحالية — أي تغيير في قواعد المنح يرفع الرقم */
export const CERTIFICATE_POLICY_VERSION = "policy-2.0.0";
/** عمر الشهادة الافتراضي بالأيام قبل انتهاء الصلاحية */
export const CERTIFICATE_TTL_DAYS = 90;

/** مادة توقيع جاهزة: مفتاح خاص + عام + keyId مشتق حتمياً من العام */
export interface SigningKeyMaterial {
  readonly privateKey: KeyObject;
  readonly publicKey: KeyObject;
  /** sha256(der المفتاح العام) أول 16 بايت hex — معرف التحقق العلني */
  readonly keyId: string;
}

/** يولد زوج Ed25519 لأغراض الإصدار — يُستخدم عند غياب مادة محملة من env */
export function generateSigningKeyMaterial(): SigningKeyMaterial {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return finalizeMaterial(privateKey, publicKey);
}

/** يحمل مادة توقيع من pkcs8 base64 (مرشح لـ CERT_SIGNING_PRIVATE_KEY مستقبلاً) */
export function loadSigningKeyMaterial(privatePkcs8Base64: string): Result<SigningKeyMaterial> {
  try {
    const privateKey = createPrivateKey({
      key: Buffer.from(privatePkcs8Base64, "base64"),
      format: "der",
      type: "pkcs8",
    });
    if (privateKey.asymmetricKeyType !== "ed25519") {
      return err(new AppError("CERT_KEY_INVALID", "مفتاح التوقيع يجب أن يكون Ed25519", false, "critical"));
    }
    return ok(finalizeMaterial(privateKey, createPublicKey(privateKey)));
  } catch (error) {
    return err(new AppError("CERT_KEY_INVALID", `مادة التوقيع غير صالحة: ${error instanceof Error ? error.message : "?"}`, false, "critical"));
  }
}

function finalizeMaterial(privateKey: KeyObject, publicKey: KeyObject): SigningKeyMaterial {
  const der = publicKey.export({ format: "der", type: "spki" });
  return { privateKey, publicKey, keyId: createHash("sha256").update(der).digest("hex").slice(0, 16) };
}

/**
 * الخريطة القانونية الموقعة: كل حقول الشهادة عدا كتلة التوقيع نفسها —
 * بالترتيب المعلن حرفياً حتى يكون التوقيع حتمياً عبر المنصات.
 */
function canonicalPayload(certificate: Certificate): string {
  return JSON.stringify({
    verificationId: certificate.verificationId,
    artifactsHash: certificate.artifactsHash,
    finalScore: certificate.finalScore,
    granted: certificate.granted,
    issuedAt: certificate.issuedAt,
    ...(certificate.notGrantedReason !== undefined ? { notGrantedReason: certificate.notGrantedReason } : {}),
    ...(certificate.notGrantedReasonCode !== undefined ? { notGrantedReasonCode: certificate.notGrantedReasonCode } : {}),
    ...(certificate.liveProbeEvidence !== undefined
      ? {
          liveProbeEvidence: {
            checksTotal: certificate.liveProbeEvidence.checksTotal,
            checksPassed: certificate.liveProbeEvidence.checksPassed,
            probedArtifactsHash: certificate.liveProbeEvidence.probedArtifactsHash,
            executedAt: certificate.liveProbeEvidence.executedAt,
          },
        }
      : {}),
    // ربط التشغيل وإثبات sandbox داخل الخريطة الموقعة — التوقيع
    // يغطيهما فيتعذر فصلهما عن قرار المنح بأي تعديل لاحق
    ...(certificate.runBinding !== undefined
      ? {
          runBinding: {
            runId: certificate.runBinding.runId,
            tenantId: certificate.runBinding.tenantId,
            policyVersion: certificate.runBinding.policyVersion,
          },
        }
      : {}),
    ...(certificate.sandbox !== undefined
      ? {
          sandbox: {
            imageRef: certificate.sandbox.imageRef,
            imageDigest: certificate.sandbox.imageDigest,
            seccompProfile: certificate.sandbox.seccompProfile,
            constraintsVersion: certificate.sandbox.constraintsVersion,
            network: certificate.sandbox.network,
            user: certificate.sandbox.user,
            exitCode: certificate.sandbox.exitCode,
          },
        }
      : {}),
  });
}

/** خيارات التوقيع: اللحظة الحالية قابلة للحقن للاختبارات الحتمية */
export interface SignOptions {
  readonly material: SigningKeyMaterial;
  readonly policyVersion?: string;
  readonly ttlDays?: number;
  readonly now?: Date;
}

/** يوقّع شهادة (عادة منححة) ويعيد نسخة تحمل كتلة التوقيع كاملة */
export function signCertificate(certificate: Certificate, options: SignOptions): Result<Certificate> {
  // لا توقيع لشهادة معلنة كمنححة فعلاً ومرفوضة منطقياً — التوقيع على قرار
  const parse = CertificateSchema.safeParse(certificate);
  if (!parse.success) return err(new AppError("CERT_MALFORMED", "رفض التوقيع: الشهادة لا تطابق مخططها", false, "warning"));
  const now = options.now ?? new Date();
  const ttlDays = options.ttlDays ?? CERTIFICATE_TTL_DAYS;
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString();
  const payload = canonicalPayload(certificate);
  const value = sign(null, Buffer.from(payload, "utf8"), options.material.privateKey).toString("base64");
  return ok({
    ...certificate,
    signature: {
      algorithm: "Ed25519" as const,
      keyId: options.material.keyId,
      policyVersion: options.policyVersion ?? CERTIFICATE_POLICY_VERSION,
      signedAt: now.toISOString(),
      expiresAt,
      value,
      revokedAtIssuance: false as const,
    },
  });
}

/** نتيجة التحقق العام — كل سبب رفض صريح ومؤرخ لا "غير صالح" مجملة */
export interface VerificationOutcome {
  readonly valid: boolean;
  readonly reason?: "bad-signature" | "expired" | "revoked" | "wrong-policy" | "malformed" | "granted-mismatch";
}

/**
 * تحقق عام مضبوط: توقيع ثم انتهاء ثم إبطال ثم سياسة ثم اتساق المنح.
 * لا يثبت «الخادم آمن» — يثبت أن هذه الشهادة بهذا القرار من هذا المُصدر.
 */
export function verifyCertificate(
  certificate: Certificate,
  options: {
    readonly publicKey: KeyObject;
    readonly now?: Date;
    /** قائمة keyIds مبطلة خارجياً (تُدار تشغيلياً في مرحلة قادمة) */
    readonly revokedKeyIds?: readonly string[];
    /** قائمة verificationIds مبطلة (سحب شهادات بعينها) */
    readonly revokedVerificationIds?: readonly string[];
    readonly expectedPolicyVersion?: string;
  },
): VerificationOutcome {
  const signature = certificate.signature;
  if (signature === undefined) return { valid: false, reason: "malformed" };
  const parse = CertificateSchema.safeParse(certificate);
  if (!parse.success) return { valid: false, reason: "malformed" };
  const signatureOk = verify(
    null,
    Buffer.from(canonicalPayload(certificate), "utf8"),
    options.publicKey,
    Buffer.from(signature.value, "base64"),
  );
  if (!signatureOk) return { valid: false, reason: "bad-signature" };
  const now = options.now ?? new Date();
  if (Date.parse(signature.expiresAt) <= now.getTime()) return { valid: false, reason: "expired" };
  if ((options.revokedKeyIds ?? []).includes(signature.keyId)) return { valid: false, reason: "revoked" };
  if ((options.revokedVerificationIds ?? []).includes(certificate.verificationId)) {
    return { valid: false, reason: "revoked" };
  }
  if (options.expectedPolicyVersion !== undefined && signature.policyVersion !== options.expectedPolicyVersion) {
    return { valid: false, reason: "wrong-policy" };
  }
  // اتساق داخلي: شهادة منححة بلا سبب رفض، ومرفوضة بسببه — لا تلاعب بالحقول
  if (certificate.granted === (certificate.notGrantedReason !== undefined)) {
    return { valid: false, reason: "granted-mismatch" };
  }
  return { valid: true };
}
