/**
 * شجرة الأخطاء الموحدة للمشروع.
 *
 * كل خطأ يصنَّف بثلاث خصائص:
 * - code: معرف ثابت للبرمجة عليه.
 * - retryable: هل يستحق إعادة محاولة تلقائية؟ (يقرر به المنسق)
 * - severity: مدى خطورته لأغراض السجل والتدقيق والتنبيهات.
 *
 * الفائدة: بدل استثناءات غامضة، يتعامل المنسق مع كل فشل بقرار واضح وموثق.
 */

/** مستويات الخطورة المعتمدة في كل النظام */
export type ErrorSeverity = "info" | "warning" | "critical";

/** الخطأ الأساسي الذي ترث منه كل أخطاء AgentBridge */
export class AppError extends Error {
  constructor(
    /** معرف ثابت مثل "SPEC_PARSE_FAILED" للبرمجة على الفروع */
    readonly code: string,
    /** رسالة عربية موجّهة للمطور/المشغل */
    message: string,
    /** هل يمكن إعادة المحاولة تلقائياً بأمان؟ */
    readonly retryable: boolean = false,
    /** درجة الخطورة */
    readonly severity: ErrorSeverity = "warning",
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** أخطاء جاهزة متكررة — تُستخدم مباشرة بدل بناء كائنات جديدة في كل موضع */
export const Errors = {
  specParseFailed: (detail: string) =>
    new AppError("SPEC_PARSE_FAILED", `فشل تحليل المواصفة: ${detail}`, false, "critical"),

  invalidInput: (field: string) =>
    new AppError("INVALID_INPUT", `مدخل غير صالح: ${field}`, false, "warning"),

  llmOutputInvalid: (agent: string) =>
    new AppError(
      "LLM_OUTPUT_INVALID",
      `خرج غير مطابق للمخطط من الوكيل ${agent} — رُفض وفق بوابة الحقيقة`,
      true,
      "warning",
    ),

  securityCritical: (findingId: string) =>
    new AppError(
      "SECURITY_CRITICAL",
      `نتيجة أمنية حرجة ${findingId} — الشهادة مرفوضة نهائياً`,
      false,
      "critical",
    ),

  internal: (detail: string) =>
    new AppError("INTERNAL", `خطأ داخلي غير متوقع: ${detail}`, false, "critical"),
} as const;
