/**
 * أخطاء حزمة الاستيعاب — تبنى فوق AppError الموحد.
 *
 * لماذا هنا وليس في shared؟ لأن هذه الرموز خاصة بمرحلة الاستيعاب فقط،
 * وإبقاؤها داخل الحزمة يحافظ على تماسكها (Cohesion) ويمنع تضخم shared.
 * كل رسالة عربية موجّهة لمن يرفع المواصفة، وكل رمز ثابت للبرمجة عليه.
 */

import { AppError, type ErrorSeverity } from "@agentbridge/shared";

/** مُنشئ داخلي موحد يضمن اتساق خصائص الخطأ الثلاث (رمز/رسالة/تصنيف) */
function make(
  code: string,
  message: string,
  retryable: boolean = false,
  severity: ErrorSeverity = "critical",
): AppError {
  return new AppError(code, message, retryable, severity);
}

/** مصنع أخطاء الاستيعاب — المنفذ الوحيد لهذه الحزمة عند الفشل */
export const SpecErrors = {
  /** تجاوز حجم الملف الحد الآمن — حماية من استنزاف الذاكرة */
  tooLarge: (maxKb: number) =>
    make("SPEC_TOO_LARGE", `حجم المواصفة يتجاوز الحد المسموح (${maxKb} كيلوبايت)`),

  /** صيغة غير مفهومة: ليس JSON ولا YAML ولا نصاً قابلاً للتحليل */
  unsupportedFormat: () =>
    make("SPEC_UNSUPPORTED_FORMAT", "الملف فارغ أو ليست بصيغة JSON/YAML معروفة"),

  /** فشل تحليل الصيغة نفسها (خطأ إغلاق قوس، مسافة بادئة خاطئة...) */
  syntaxFailed: (detail: string) => make("SPEC_PARSE_FAILED", `فشل تحليل النص: ${detail}`),

  /** البنية لا تطابق هيكل OpenAPI الأساسي (openapi/info/paths) */
  invalidStructure: (detail: string) =>
    make("SPEC_INVALID_STRUCTURE", `بنية المواصفة غير سليمة: ${detail}`),

  /** إصدار OpenAPI غير مدعوم — ندعم 3.x حصراً */
  unsupportedVersion: (found: string) =>
    make("SPEC_UNSUPPORTED_VERSION", `إصدار OpenAPI "${found}" غير مدعوم — المدعوم 3.x فقط`),

  /** مرجع $ref يشير إلى مكان غير موجود داخل المستند */
  brokenRef: (ref: string) =>
    make("SPEC_BROKEN_REF", `مرجع $ref يشير إلى موقع غير موجود داخل المستند: ${ref}`),

  /** مرجع خارجي — ممنوع لأسباب أمنية وقابلية التشغيل دون شبكة */
  externalRef: (ref: string) =>
    make(
      "SPEC_EXTERNAL_REF",
      `مرجع خارجي مرفوض لأسباب أمنية: ${ref} — ادمج المستند كاملاً في ملف واحد`,
    ),

  /** نمط حقن تعليمات مشبوه في نصوص المواصفة — بوابة الحقيقة ترفضه مبكراً */
  suspiciousContent: (pointer: string) =>
    make(
      "SPEC_SUSPICIOUS_CONTENT",
      `محتوى مشبوه بحقن التعليمات في ${pointer} — راجع أوصاف المواصفة وأزل محاولات التحكم بالوكلاء`,
    ),
} as const;
