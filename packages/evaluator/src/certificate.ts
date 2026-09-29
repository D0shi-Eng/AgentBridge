/**
 * الشهادة — دمج تقارير التحصين (والجودة عند توفرها) في قرار نهائي 0–100.
 *
 * القواعد المثبتة (docs/systems.md §6 وdocs/verification-and-evidence.md):
 *   1. بوابة الرفض الحرجة: أي SecurityFinding حرجة = granted=false
 *      بغض النظر عن الدرجة — لا استثناء ولا تعويض ببنود أخرى.
 *   2. عتبة المنح ≥ 85.
 *   3. وزن الدمج: حتى توفر درجات الجودة فالدرجة = نظافة
 *      التحصين؛ وعند توفرها تُدمج 60% أمان + 40% جودة،
 *   ويُستكمل نموذج الثقة المرجون الكامل عند اكتمال المقيم.
 *   4. رقم التحقق verificationId مشتق hash من بصمة الـartifacts والدرجة
 *      وزمن الإصدار — قابل للتحقق عمومياً وغير قابل للتزوير رجعياً.
 *
 * كل مداخل هنا تتحقق مخططياً أولاً (لا ثقة عمياء — القاعدة 16).
 */

import { createHash } from "node:crypto";
import {
  QualityScoreSchema,
  SecurityReportSchema,
  type Certificate,
  type GeneratedServerArtifact,
  type LiveProbeEvidence,
  type NotGrantedReasonCode,
  type QualityScore,
  type SecurityReport,
} from "@agentbridge/shared";
import { err, ok, type Result } from "@agentbridge/shared";
import { CertErrors } from "./errors.js";
import { CERTIFICATE_POLICY_VERSION } from "./certificate-signing.js";

/** عتبة منح شهادة "Agent-Ready Verified" — مثبتة في ذاكرة المشروع */
export const CERTIFICATION_THRESHOLD = 85;

export interface CertificationInput {
  /** الـartifact المفحوص — تُحسب منه البصمة الملزمة بالشهادة */
  readonly artifact: GeneratedServerArtifact;
  readonly securityReport: SecurityReport;
  /** درجات الجودة من المقيم — اختيارية حتى اكتمال حزمة المقيم */
  readonly qualityScores?: readonly QualityScore[];
  /**
   * دليل الفئات الحية: غيابه يجعل المنح مستحيلاً —
   * fail-closed حتى تبقى الشهادة ادعاءً مضبوطاً لا شعاراً.
   */
  readonly liveProbeEvidence?: LiveProbeEvidence;
  /**
   * ربط خادمي: التشغيل والمستأجر وسياسة الشهادة يدخلون حساب
   * verificationId فيصبح حتمياً — إعادة إصدار لنفس (تشغيل × artifact ×
   * سياسة) تعيد نفس الرقم فلا تكرار شهادة للتشغيل الواحد.
   * زمن الإصدار يخرج من الحساب عمداً: هو معلومة توثيق لا مفتاح هوية.
   */
  readonly runBinding?: {
    readonly runId: string;
    readonly tenantId: string;
    readonly policyVersion: string;
  };
  /**
   * إثبات sandbox: عند تمريره يصبح مشروطاً فعلياً بالمنح —
   * exit غير صفري أو شبكة غير معزولة أو بصمة صورة "unverified" تمنع المنح.
   * metadata زخرفية لا تكفي — الضابط هنا بوابات مرفوضة صريحة.
   */
  readonly sandbox?: {
    readonly imageRef: string;
    readonly imageDigest: string;
    readonly seccompProfile: string;
    readonly constraintsVersion: string;
    readonly network: string;
    readonly user: string;
    readonly exitCode: number;
  };
  /** زمن الإصدار ISO — يُحقن للاختبارات الحتمية، وإلا اللحظة الحالية */
  readonly now?: string;
}

/** بصمة SHA-256 للـartifact: الملفات مرتبة بالمسمى فلا يتغير مع الترتيب الوارد */
export function computeArtifactsHash(artifact: GeneratedServerArtifact): string {
  const canonical = JSON.stringify({
    files: [...artifact.files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    toolNames: [...artifact.toolNames],
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** يتحقق من درجات الجودة الواصلة عبر مخططها ويعيد متوسطها إن وُجدت */
function averageQuality(scores: readonly QualityScore[] | undefined): Result<number | undefined> {
  if (scores === undefined) return ok(undefined);
  for (const score of scores) {
    const parsed = QualityScoreSchema.safeParse(score);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => issue.path.join(".")).join("، ");
      return err(CertErrors.invalidQualityScores(`درجة مخالفة عند: ${issues}`));
    }
  }
  if (scores.length === 0) return ok(undefined);
  const total = scores.reduce((sum, score) => sum + score.score, 0);
  return ok(Math.round((total / scores.length) * 100) / 100);
}

/**
 * يتحقق من دليل الفئات الحية — بوابة fail-closed.
 * الدليل الصالح: موجود، بصمته تطابق الـartifact المعتمد، وكل فحوصه نجحت.
 * لا ثقة بأي قيمة حية مصدرها العميل — الدليل يُبنى خادمياً من نتائج المنسق.
 */
function liveEvidenceValid(
  evidence: LiveProbeEvidence | undefined,
  artifactsHash: string,
): { valid: boolean; reason?: string; code?: NotGrantedReasonCode } {
  if (evidence === undefined) {
    return { valid: false, reason: "لا فئات حية منفذة", code: "LIVE_EVIDENCE_MISSING" };
  }
  if (evidence.probedArtifactsHash !== artifactsHash) {
    return {
      valid: false,
      reason: "دليل الفئات الحية لا يخص هذا الـartifact (بصمة غير مطابقة)",
      code: "LIVE_EVIDENCE_HASH_MISMATCH",
    };
  }
  if (evidence.checksTotal <= 0 || evidence.checksPassed !== evidence.checksTotal) {
    return {
      valid: false,
      reason: `فحوص حية غير مكتملة: ${evidence.checksPassed}/${evidence.checksTotal}`,
      code: "LIVE_EVIDENCE_INCOMPLETE",
    };
  }
  return { valid: true };
}

/**
 * بوابة إثبات sandbox الملزمة عند حضوره — حضور الإثبات
 * غير المستوفى يمنع المنح: exit غير صفري (فحوص لم تكتمل داخل العزل)،
 * شبكة غير "none" (تسريب محتمل من العزل)، أو بصمة صورة "unverified"
 * (هوية بيئة التنفيذ غير مثبتة). غياب الإثبات كلياً لا يمنح وحده —
 * يبقى بوابته في liveEvidenceValid.
 */
function sandboxEvidenceValid(
  sandbox: CertificationInput["sandbox"],
): { valid: boolean; reason?: string } {
  if (sandbox === undefined) return { valid: true };
  if (sandbox.exitCode !== 0) {
    return { valid: false, reason: `sandbox خرج بغير صفري (${sandbox.exitCode}) — فحوص العزل غير مكتملة` };
  }
  if (sandbox.network !== "none") {
    return { valid: false, reason: `sandbox بشبكة ${sandbox.network} — العزل الشبكي غير مثبت` };
  }
  if (sandbox.imageDigest === "unverified" || sandbox.imageDigest.length < 8) {
    return { valid: false, reason: "بصمة صورة sandbox غير موثقة — لا تحقق بيئة التنفيذ" };
  }
  return { valid: true };
}

/**
 * يصدر قرار الشهادة النهائي من مدخلات موثقة.
 * يعيد Certificate دائماً عند سلامة المدخلات — حتى المرفوض يحمل درجته ورقمه
 * وسببه الصريح ليبقى في سجل التدقيق أثر القرار السلبي كالأيجابي.
 */
export function certifyArtifacts(input: CertificationInput): Result<Certificate> {
  // بوابة الحقيقة: التقرير الواصل عبر حدود العملية يتحقق مخططياً أولاً
  const reportParse = SecurityReportSchema.safeParse(input.securityReport);
  if (!reportParse.success) {
    const detail = reportParse.error.issues.map((issue) => issue.path.join(".")).join("، ");
    return err(CertErrors.invalidSecurityReport(detail));
  }
  const report: SecurityReport = reportParse.data;

  // إعادة حساب الحرجة من النتائج نفسها — لا ثقة بالحقل المحسوب وحده
  const hasCritical =
    report.hasCritical || report.findings.some((finding) => finding.severity === "critical");

  if (report.totalChecks === 0) return err(CertErrors.noChecksExecuted());

  const qualityAvg = averageQuality(input.qualityScores);
  if (!qualityAvg.ok) return qualityAvg;

  const securityScore = report.cleanlinessScore;
  const finalScore =
    qualityAvg.value !== undefined
      ? Math.round(0.6 * securityScore + 0.4 * (qualityAvg.value ?? 0))
      : securityScore;

  const issuedAt = input.now ?? new Date().toISOString();
  const artifactsHash = computeArtifactsHash(input.artifact);
  // verificationId حتمي من (تشغيل × مستأجر × artifact ×
  // درجة × قرار × سياسة) — الحتمية وحدها ليست idempotency، لكن ربط
  // المفتاح المنطقي بهوية التشغيل يجعل إعادة الإصدار تعيد نفس الرقم،
  // وأعلى مجرى التخزين upsert بمفتاح فريد فيمنع تكرار شهادة التشغيل.
  const binding = input.runBinding;
  const verificationSeed = [
    binding?.tenantId ?? "",
    binding?.runId ?? "",
    binding?.policyVersion ?? CERTIFICATE_POLICY_VERSION,
    artifactsHash,
    String(finalScore),
  ].join(":");
  const verificationId =
    "AB-" + createHash("sha256").update(verificationSeed).digest("hex").slice(0, 16);

  // بوابة الرفض الحرجة قبل شرط العتبة: الحرجة تلغي مهما بلغت الدرجة
  // ثم بوابة الفئات الحية ثم بوابة إثبات sandbox:
  // بلا دليل حي صالح أو بإثبات عزل غير مستوفٍ = لا منح مهما كانت الدرجة
  const live = liveEvidenceValid(input.liveProbeEvidence, artifactsHash);
  const sandbox = sandboxEvidenceValid(input.sandbox);
  const granted = !hasCritical && finalScore >= CERTIFICATION_THRESHOLD && live.valid && sandbox.valid;
  // الرمز الهيكلي يُشتق من فرع القرار نفسه (لا مطابقة نصوص) ليترجم حسب اللغة
  const notGrantedReasonCode: NotGrantedReasonCode | undefined = granted
    ? undefined
    : hasCritical
      ? "CRITICAL_FINDINGS"
      : finalScore < CERTIFICATION_THRESHOLD
        ? "SCORE_BELOW_THRESHOLD"
        : !live.valid
          ? (live.code ?? "LIVE_EVIDENCE_MISSING")
          : "SANDBOX_EVIDENCE_INVALID";
  const notGrantedReason = granted
    ? undefined
    : hasCritical
      ? "نتيجة حرجة في تقرير التحصين — بوابة الرفض الحرجة"
      : finalScore < CERTIFICATION_THRESHOLD
        ? `الدرجة ${finalScore} دون عتبة المنح ${CERTIFICATION_THRESHOLD}`
        : !live.valid
          ? (live.reason ?? "فئات حية غير مستوفاة")
          : (sandbox.reason ?? "إثبات sandbox غير مستوفٍ");

  return ok({
    verificationId,
    artifactsHash,
    finalScore,
    granted,
    issuedAt,
    ...(notGrantedReason !== undefined ? { notGrantedReason } : {}),
    ...(notGrantedReasonCode !== undefined ? { notGrantedReasonCode } : {}),
    ...(input.liveProbeEvidence !== undefined ? { liveProbeEvidence: input.liveProbeEvidence } : {}),
    ...(binding !== undefined ? { runBinding: binding } : {}),
    ...(input.sandbox !== undefined ? { sandbox: input.sandbox } : {}),
  });
}
