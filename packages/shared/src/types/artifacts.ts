/**
 * أنواع مخرجات التوليد والتقييم والشهادة — "منتجات" مسار المعالجة.
 *
 * تُستخدم في generator و hardening و evaluator.
 * كل artifact يحمل بصمة hash لربطه بشهادته لاحقاً (انظر verification-and-evidence.md §قواعد).
 */

import { z } from "zod";

/** أداة MCP واحدة مصممة (مخارج وكيل المصمم، مدخل المولّد) */
export interface ToolDesign {
  /** اسم الأداة بصيغة snake_case قابلة للاكتشاف */
  readonly name: string;
  /** وصف موجّه للوكيل المستهلك — كل جملته يجب أن تكون موثقة بمصدر */
  readonly description: string;
  /** معرفات endpoints التي تُنفذها الأداة بالترتيب */
  readonly endpointIds: readonly string[];
  /** مخطط المعاملات كـ JSON Schema مبسط */
  readonly parameters: Readonly<Record<string, ParameterSpec>>;
}

/** تعريف معامل واحد في أداة */
export interface ParameterSpec {
  readonly type: "string" | "number" | "boolean";
  readonly required: boolean;
  /** وصف المعامل — يجب أن يأتي من توثيق المواصفة حصراً */
  readonly description: string;
}

/** نتيجة أمنية واحدة من نظام التحصين */
export interface SecurityFinding {
  /** معرف فريد للنتيجة */
  readonly id: string;
  readonly severity: "critical" | "high" | "medium" | "info";
  /** عنوان النتيجة بالعربية */
  readonly title: string;
  /** موضعها في الكود أو الإعداد إن أمكن */
  readonly location?: string;
  /** شرح عربي موجز لسبب النتيجة — يوثق القرار بدل تركه ضمنياً */
  readonly detail?: string;
}

/** تقرير التحصين الكامل: كل الفحوص المنفذة وخلاصتها القابلة للتقييم */
export interface SecurityReport {
  /** النتائج الأمنية = الفحوص التي لم تجتز فقط؛ الاجتياز لا ينتج نتيجة */
  readonly findings: readonly SecurityFinding[];
  /** إجمالي الفحوص المنفذة (ساكنة + حية) */
  readonly totalChecks: number;
  /** عدد الفحوص المجتازة */
  readonly passedCount: number;
  /** هل وُجدت نتيجة حرجة واحدة؟ = بوابة الرفض الحرجة في الشهادة */
  readonly hasCritical: boolean;
  /** درجة النظافة 0–100: حرجة واحدة = صفر، وإلا خصم بحسب خطورة كل فشل */
  readonly cleanlinessScore: number;
}

/** درجة جودة أداة واحدة من المقيم */
export interface QualityScore {
  readonly toolName: string;
  /** الدرجة من 100 */
  readonly score: number;
  /** مبررات البنود — بدونها يرفض المدقق الدرجة كلها */
  readonly reasons: readonly string[];
}

/**
 * رموز أسباب عدم المنح — هيكلية مشتقة من فرع قرار المنح حصراً،
 * تُضمَّن في الشهادة الموقعة وتُترجم في الواجهات حسب اللغة.
 */
export type NotGrantedReasonCode =
  | "CRITICAL_FINDINGS"
  | "SCORE_BELOW_THRESHOLD"
  | "LIVE_EVIDENCE_MISSING"
  | "LIVE_EVIDENCE_HASH_MISMATCH"
  | "LIVE_EVIDENCE_INCOMPLETE"
  | "SANDBOX_EVIDENCE_INVALID";

/** الشهادة النهائية القابلة للتحقق عمومياً */
export interface Certificate {
  /** رقم تحقق عام يمكن للطرف الثالث التحقق منه */
  readonly verificationId: string;
  /** بصمة SHA-256 لكل artifacts المفحوصة */
  readonly artifactsHash: string;
  /** الدرجة النهائية المرجونة 0–100 */
  readonly finalScore: number;
  /** هل مُنحت الشهادة؟ (≥85 وبلا نتائج حرجة وبفئات حية مثبتة) */
  readonly granted: boolean;
  readonly issuedAt: string;
  /** سبب عدم المنح الصريح — موجود دائماً عند granted=false (لا رفض صامت) */
  readonly notGrantedReason?: string;
  /**
   * رمز السبب الهيكلي — يُشتق من فرع الرفض لا من النص، فتترجمه
   * الواجهات حسب اللغة دون عرض النص الخام ولا مطابقة نصوص.
   */
  readonly notGrantedReasonCode?: NotGrantedReasonCode;
  /**
   * دليل الفئات الحية: بوابة fail-closed — المنح مستحيل بلا
   * فحوص حية ناجحة مرتبطة بنفس الـartifact. غيابه مع granted=false سببه
   * "ل_live_probes" موثق في notGrantedReason.
   */
  readonly liveProbeEvidence?: LiveProbeEvidence;
  /**
   * ربط خادمي للمنح: التشغيل والمستأجر وإصدار السياسة — يدخل
   * التوقيع وحساب verificationId فيصبح الرقم حتمياً (idempotency منطقي:
   * إعادة إصدار لنفس التشغيل والartifact والسياسة تعيد نفس الرقم).
   */
  readonly runBinding?: {
    readonly runId: string;
    readonly tenantId: string;
    readonly policyVersion: string;
  };
  /**
   * إثبات sandbox الملزم بالمنح عند وجوده: غير المستوفى يمنع
   * المنح فعلياً (لا metadata زخرفية) — صورة/بصمة/seccomp/شبكة/مستخدم/exit.
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
  /**
   * كتلة التوقيع: تثبت منشأ الشهادة وسلامتها من التعديل —
   * لا تثبت وحدها أن الخادم آمن. المفتاح الخاص منفصل كلياً عن الشهادة.
   */
  readonly signature?: CertificateSignature;
}

/** دليل تشغيل الفحوص الحية المرتبط بالـartifact المعتمد */
export interface LiveProbeEvidence {
  /** إجمالي فحوص HD المنفذة حياً */
  readonly checksTotal: number;
  /** منها ما اجتاز — يجب أن يساوي checksTotal لقاعدة المنح */
  readonly checksPassed: number;
  /** بصمة الـartifact المفحوص حياً — يجب أن تطابق artifactsHash للشهادة */
  readonly probedArtifactsHash: string;
  /** لحظة تنفيذ الفئات ISO */
  readonly executedAt: string;
}

/** مخطط الدليل الحي — يعاد استخدامه في الشهادة وفي snapshots المنسق */
export const LiveProbeEvidenceSchema = z
  .object({
    checksTotal: z.number().int().positive(),
    checksPassed: z.number().int().min(0),
    probedArtifactsHash: z.string().length(64),
    executedAt: z.string(),
  })
  .strict();

/** كتلة توقيع الشهادة — primitives قياسية Ed25519 عبر node:crypto */
export interface CertificateSignature {
  /** الخوارزمية الوحيدة المدعومة في السياسة الحالية */
  readonly algorithm: "Ed25519";
  /** معرف المفتاح العام = sha256(المفتاح العام) مقطعاً — للعثور على مفتاح التحقق */
  readonly keyId: string;
  /** إصدار سياسة الشهادة التي حكمت بالمنح */
  readonly policyVersion: string;
  /** لحظة التوقيع ISO */
  readonly signedAt: string;
  /** لحظة انتهاء صلاحية الشهادة ISO — التحقق العام يرفض المنتهية */
  readonly expiresAt: string;
  /** التوقيع نفسه base64 على الخرائط القانونية للشهادة (بدون كتلة التوقيع) */
  readonly value: string;
  /** حالة الإبطال عند الإصدار — الإبطال اللاحق خارج التوقيع في قائمة إبطال */
  readonly revokedAtIssuance: false;
}

/* مخططات Zod لحدود العملية */

export const ParameterSpecSchema = z
  .object({
    type: z.enum(["string", "number", "boolean"]),
    required: z.boolean(),
    description: z.string().min(1),
  })
  .strict();

/** مخطط تصميم الأداة — بوابة قبول مخرجات وكيل المصمم ومدخل المولّد */
export const ToolDesignSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, "اسم الأداة يجب أن يكون snake_case"),
    description: z.string().min(10),
    endpointIds: z.array(z.string().min(1)).min(1),
    parameters: z.record(z.string(), ParameterSpecSchema),
  })
  .strict();

/** ملف واحد داخل artifact الخادم المولد (مسار نسبي + محتوى نصي) */
export interface GeneratedFile {
  /** مسار نسبي داخل مجلد الحزمة مثل "src/server.ts" */
  readonly path: string;
  readonly contents: string;
}

/** artifact الخادم المولد كاملاً — مدخل التحصين والتقييم لاحقاً */
export interface GeneratedServerArtifact {
  readonly files: readonly GeneratedFile[];
  /** أسماء الأدوات المسجلة بالترتيب */
  readonly toolNames: readonly string[];
}

export const SecurityFindingSchema = z.object({
  id: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "info"]),
  title: z.string().min(1),
  location: z.string().optional(),
  detail: z.string().optional(),
});

export const SecurityReportSchema = z
  .object({
    findings: z.array(SecurityFindingSchema),
    totalChecks: z.number().int().nonnegative(),
    passedCount: z.number().int().nonnegative(),
    hasCritical: z.boolean(),
    cleanlinessScore: z.number().int().min(0).max(100),
  })
  .strict();

export const QualityScoreSchema = z
  .object({
    toolName: z.string().min(1),
    score: z.number().int().min(0).max(100),
    reasons: z.array(z.string()).min(1),
  })
  .strict();

/** مخطط ملف مولد — يستخدمه التحقق المخططي لـsnapshots الاستئناف */
export const GeneratedFileSchema = z
  .object({
    path: z.string().min(1),
    contents: z.string(),
  })
  .strict();

/** مخطط artifact الخادم المولد كاملاً */
export const GeneratedServerArtifactSchema = z
  .object({
    files: z.array(GeneratedFileSchema).min(1),
    toolNames: z.array(z.string()),
  })
  .strict();

/** مخطط الشهادة النهائية — يتحقق به كل ما يعبر حدود العملية أو يُستأنف */
export const CertificateSchema = z
  .object({
    verificationId: z.string().regex(/^AB-[0-9a-f]{16}$/, "رقم تحقق بصيغة AB-<16 hex>"),
    artifactsHash: z.string().length(64),
    finalScore: z.number().int().min(0).max(100),
    granted: z.boolean(),
    issuedAt: z.string(),
    notGrantedReason: z.string().min(1).optional(),
    notGrantedReasonCode: z
      .enum([
        "CRITICAL_FINDINGS",
        "SCORE_BELOW_THRESHOLD",
        "LIVE_EVIDENCE_MISSING",
        "LIVE_EVIDENCE_HASH_MISMATCH",
        "LIVE_EVIDENCE_INCOMPLETE",
        "SANDBOX_EVIDENCE_INVALID",
      ])
      .optional(),
    liveProbeEvidence: LiveProbeEvidenceSchema.optional(),
    /**
     * ربط خادمي للمنح: التشغيل والمستأجر وإصدار السياسة
     * التي صدرت عنها الشهادة — يدخل التوقيع وحساب verificationId.
     */
    runBinding: z
      .object({
        runId: z.string().min(1),
        tenantId: z.string().min(1),
        policyVersion: z.string().min(1),
      })
      .strict()
      .optional(),
    /**
     * إثبات sandbox الملزم بالمنح عند وجوده: حاوية الفحوص الحية
     * بهويتها (صورة/بصمة/seccomp/شبكة/مستخدم/exit). حاضراً غير مستوفٍ
     * يمنع المنح — ليس metadata زخرفية.
     */
    sandbox: z
      .object({
        imageRef: z.string().min(1),
        imageDigest: z.string().min(1),
        seccompProfile: z.string().min(1),
        constraintsVersion: z.string().min(1),
        network: z.string().min(1),
        user: z.string().min(1),
        exitCode: z.number().int(),
      })
      .strict()
      .optional(),
    signature: z
      .object({
        algorithm: z.literal("Ed25519"),
        keyId: z.string().min(8).max(64),
        policyVersion: z.string().min(1).max(32),
        signedAt: z.string(),
        expiresAt: z.string(),
        value: z.string().min(16),
        revokedAtIssuance: z.literal(false),
      })
      .strict()
      .optional(),
  })
  .strict();
