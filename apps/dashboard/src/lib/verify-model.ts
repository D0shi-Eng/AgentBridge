/**
 * نموذج صفحة التحقق العام النقي — يفك رد /verify/:verificationId ويثبت شكله.
 * هذه الواجهة عامة بلا مصادقة، فالتحقق اليدوي هنا هو بوابة الحقيقة:
 * أي حقل مفقود أو مخالف يعيد null وتعرض الصفحة «غير موجود» لا بيانات ناقصة.
 */

import { t } from "./i18n";

/** نتيجة التحقق التوقيعي كما يعيده /verify — الأسباب معرفات ثابتة */
export type SignatureReason = "bad-signature" | "expired" | "revoked" | "wrong-policy" | "malformed" | "granted-mismatch";

export interface PublicSignature {
  readonly present: boolean;
  readonly valid?: boolean;
  readonly reason?: SignatureReason;
}

/** البيانات العامة المسموح عرضها — بلا أي إشارة لمستأجر أو تشغيل */
export interface PublicVerification {
  readonly verificationId: string;
  readonly artifactsHash: string;
  readonly finalScore: number;
  readonly granted: boolean;
  readonly issuedAt: string;
  /** إبطال موثق (صف revocation) — علم مستقل عن التوقيع */
  readonly revoked: boolean;
  /** كتلة التوقيع — غيابها = شهادة تطوير غير موقعة (بلا ادعاء توقيع) */
  readonly signature?: PublicSignature;
}

const HEX64 = /^[0-9a-f]{64}$/;

const SIGNATURE_REASONS: readonly SignatureReason[] = [
  "bad-signature", "expired", "revoked", "wrong-policy", "malformed", "granted-mismatch",
];

function parseSignature(raw: unknown): PublicSignature | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const candidate = raw as { present?: unknown; valid?: unknown; reason?: unknown };
  if (typeof candidate.present !== "boolean") return undefined;
  if (candidate.present === false) return { present: false };
  if (typeof candidate.valid !== "boolean") return undefined;
  if (candidate.reason === undefined) return { present: true, valid: candidate.valid };
  if (typeof candidate.reason !== "string" || !SIGNATURE_REASONS.includes(candidate.reason as SignatureReason)) {
    return undefined;
  }
  return { present: true, valid: candidate.valid, reason: candidate.reason as SignatureReason };
}

/** يتحقق من شكل الرد يدوياً — null يعني «قرار غير معروف» في الصفحة */
export function parsePublicVerification(raw: unknown): PublicVerification | null {
  if (typeof raw !== "object" || raw === null) return null;
  const candidate = raw as Partial<Record<keyof PublicVerification, unknown>>;
  if (
    typeof candidate.verificationId === "string" &&
    /^AB-[0-9a-f]{16}$/.test(candidate.verificationId) &&
    typeof candidate.artifactsHash === "string" &&
    HEX64.test(candidate.artifactsHash) &&
    typeof candidate.finalScore === "number" &&
    Number.isInteger(candidate.finalScore) &&
    candidate.finalScore >= 0 &&
    candidate.finalScore <= 100 &&
    typeof candidate.granted === "boolean" &&
    typeof candidate.issuedAt === "string" &&
    !Number.isNaN(Date.parse(candidate.issuedAt)) &&
    typeof candidate.revoked === "boolean"
  ) {
    const signature = parseSignature(candidate.signature);
    // كتلة توقيع حاضرة لكن مخالفة الشكل = رد كامل مرفوض — لا عرض بقرار مشوه
    if (candidate.signature !== undefined && signature === undefined) return null;
    return {
      verificationId: candidate.verificationId,
      artifactsHash: candidate.artifactsHash,
      finalScore: candidate.finalScore,
      granted: candidate.granted,
      issuedAt: candidate.issuedAt,
      revoked: candidate.revoked,
      ...(signature !== undefined ? { signature } : {}),
    };
  }
  return null;
}

export interface VerifyFactRow {
  readonly key: string;
  readonly value: string;
  /** القيم التقنية تعرض بخط أحادي المسافة باتجاه LTR */
  readonly mono?: boolean;
  /** القيمة الكاملة عند اقتطاع العرض — لزر النسخ دون تغيير المعنى */
  readonly fullValue?: string;
}

/**
 * صفوف بطاقة القرار حسب لغة الواجهة — زمن مقروء بتنسيق اللغة والبصمة مقطوعة
 * العرض مع قيمتها الكاملة في fullValue كي يتاح نسخها (لا تغيير في المعنى).
 * حالات revoked/expired تُعرض بلوحتها المخصصة في الصفحة؛
 * هذه الصفوف تحمل حقول القرار الثابتة فقط.
 */
export function verificationFacts(verification: PublicVerification, locale: "ar" | "en"): VerifyFactRow[] {
  const dateFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return [
    { key: t("verify.factId", locale), value: verification.verificationId, mono: true },
    { key: t("verify.factIssuedAt", locale), value: dateFormatter.format(new Date(verification.issuedAt)) },
    { key: t("verify.factHash", locale), value: verification.artifactsHash.slice(0, 32) + "…", mono: true, fullValue: verification.artifactsHash },
    { key: t("verify.factScore", locale), value: `${verification.finalScore} / 100` },
  ];
}
