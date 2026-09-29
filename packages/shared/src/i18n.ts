/**
 * قاموس التدويل الحتمي — مفتاح واحد ⇒ ترجمتان (ar/en) بلا أي شبكة.
 *
 * ماهيته: دالة t(key, locale, vars) تعيد النص المترجم مع تعويض المتغيرات.
 * وظيفته: توحيد كل رسائل AppError الحرجة + HITL/الشهادة بترجمتين مضمونتين.
 * كيف: سجل ثابت Record<I18nKey, {ar:string,en:string}> + استبدال {{var}} حتمياً — لا any.
 */

export type Locale = "ar" | "en";

export const I18N_KEYS = [
  "error.SPEC_PARSE_FAILED",
  "error.INVALID_INPUT",
  "error.LLM_OUTPUT_INVALID",
  "error.SECURITY_CRITICAL",
  "error.INTERNAL",
  "error.UNAUTHORIZED",
  "error.NOT_FOUND",
  "error.SPEC_TOO_LARGE",
  "error.NO_SNAPSHOT",
  "error.RUN_ALREADY_ACTIVE",
  "error.LLM_BUDGET_EXCEEDED",
  "error.HARD_LIVE_PROBES_FAILED",
  "error.CERT_INVALID",
  "error.PROJECT_NOT_FOUND",
  "error.SPEC_NOT_FOUND",
  "error.PIPELINE_NOT_FOUND",
  "error.ROUTE_NOT_FOUND",
  "error.REQUEST_TOO_LARGE",
  "error.INVALID_BODY",
  "error.METRICS_OPERATOR_ONLY",
  "hitl.suspended",
  "hitl.approved",
  "hitl.rejected",
  "certificate.granted",
  "certificate.rejected",
  "flywheel.empty",
  "ui.search",
  "ui.delete",
  "ui.confirmDelete",
] as const;

export type I18nKey = (typeof I18N_KEYS)[number];

type Dict = Record<I18nKey, { readonly ar: string; readonly en: string }>;

const DICT: Dict = {
  "error.SPEC_PARSE_FAILED": { ar: "فشل تحليل المواصفة: {{detail}}", en: "Failed to parse spec: {{detail}}" },
  "error.INVALID_INPUT": { ar: "مدخل غير صالح: {{field}}", en: "Invalid input: {{field}}" },
  "error.LLM_OUTPUT_INVALID": { ar: "خرج غير مطابق للمخطط من الوكيل {{agent}} — رُفض وفق بوابة الحقيقة", en: "Output from agent {{agent}} failed schema validation — rejected by truth gate" },
  "error.SECURITY_CRITICAL": { ar: "نتيجة أمنية حرجة {{findingId}} — الشهادة مرفوضة نهائياً", en: "Critical security finding {{findingId}} — certificate rejected" },
  "error.INTERNAL": { ar: "خطأ داخلي غير متوقع", en: "Unexpected internal error" },
  "error.UNAUTHORIZED": { ar: "بيانات المصادقة غير صالحة أو مفقودة", en: "Invalid or missing authentication" },
  "error.NOT_FOUND": { ar: "المورد غير موجود", en: "Resource not found" },
  "error.SPEC_TOO_LARGE": { ar: "حجم المواصفة يتجاوز الحد المسموح", en: "Spec size exceeds allowed limit" },
  "error.NO_SNAPSHOT": { ar: "لا توجد نقطة استئناف محفوظة لهذا التشغيل", en: "No snapshot found for this run" },
  "error.RUN_ALREADY_ACTIVE": { ar: "التشغيل جارٍ بالفعل ولا يقبل استئنافاً موازياً", en: "Run is already active — cannot resume in parallel" },
  "error.LLM_BUDGET_EXCEEDED": { ar: "تجاوز سقف تكلفة النماذج الشهري", en: "Monthly LLM budget exceeded" },
  "error.HARD_LIVE_PROBES_FAILED": { ar: "فشلت الفحوص الحية للتحصين", en: "Hardening live probes failed" },
  "error.CERT_INVALID": { ar: "الشهادة غير صالحة", en: "Invalid certificate" },
  "error.PROJECT_NOT_FOUND": { ar: "المشروع غير موجود", en: "Project not found" },
  "error.SPEC_NOT_FOUND": { ar: "المواصفة غير موجودة", en: "Spec not found" },
  "error.PIPELINE_NOT_FOUND": { ar: "التشغيل غير موجود", en: "Pipeline not found" },
  "error.ROUTE_NOT_FOUND": { ar: "المسار غير موجود", en: "Route not found" },
  "error.REQUEST_TOO_LARGE": { ar: "حجم الطلب يتجاوز الحد المسموح", en: "Request payload too large" },
  "error.INVALID_BODY": { ar: "جسم الطلب غير صالح", en: "Invalid request body" },
  "error.METRICS_OPERATOR_ONLY": { ar: "مقاييس المنصة العامة محصورة بالمشغّل — لا تُعرض لمستأجر في النشر الشبكي", en: "Platform-wide metrics are operator-only — not shown to tenants in a networked deployment" },
  "hitl.suspended": { ar: "بانتظار مراجعة بشرية", en: "Awaiting human review" },
  "hitl.approved": { ar: "اعتُمدت الأدوات — يكمل التشغيل نحو الشهادة", en: "Tools approved — pipeline continues to certification" },
  "hitl.rejected": { ar: "رُفض التشغيل وأُحيل لمراجعة بشرية أخرى", en: "Run rejected and escalated for another human review" },
  "certificate.granted": { ar: "الشهادة ممنوحة", en: "Certificate granted" },
  "certificate.rejected": { ar: "الشهادة مرفوضة", en: "Certificate rejected" },
  "flywheel.empty": { ar: "لا دروس بعد", en: "No lessons yet" },
  "ui.search": { ar: "بحث", en: "Search" },
  "ui.delete": { ar: "حذف", en: "Delete" },
  "ui.confirmDelete": { ar: "هل أنت متأكد من حذف هذا الدرس؟", en: "Are you sure you want to delete this lesson?" },
};

/**
 * دالة الترجمة الحتمية — تُعيد النص حسب اللغة مع تعويض {{var}} إن وُجدت
 */
export function t(key: I18nKey, locale: Locale, vars?: Readonly<Record<string, string>>): string {
  const entry = DICT[key];
  const raw = entry[locale] ?? entry.ar;
  if (vars === undefined) return raw;
  let out = raw;
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{{${name}}}`).join(value);
  }
  return out;
}

/** هل المفتاح معروف في القاموس؟ */
export function isI18nKey(value: string): value is I18nKey {
  return (I18N_KEYS as readonly string[]).includes(value);
}
