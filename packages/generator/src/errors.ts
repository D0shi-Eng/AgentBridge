/**
 * مصنع أخطاء حزمة generator — امتداد لشجرة الأخطاء الموحدة في shared.
 *
 * كل أخطاء التوليد غير قابلة لإعادة المحاولة العمياء: سببها مدخل فاسد
 * من أعلى الأنابيب، وعلاجه إصلاح المدخل أو وكيل الإصلاح لا التكرار.
 */

import { AppError } from "@agentbridge/shared";

export const GenErrors = {
  limitExceeded: () => new AppError("GEN_LIMIT_EXCEEDED",
    "تجاوز حجم التوليد المسموح — Generation size limit exceeded", false, "warning"),
  unsupportedParameter: () => new AppError("GEN_UNSUPPORTED_PARAMETER",
    "عقد معامل غير مدعوم دون تغيير معناه — Parameter contract cannot be preserved", false, "warning"),
  /** دفعة تصميم فارغة — لا معنى لخادم بلا أدوات */
  noTools: () =>
    new AppError("GEN_NO_TOOLS", "لا يمكن توليد خادم MCP بدون أداة واحدة على الأقل", false, "warning"),

  invalidDesign: (detail: string) =>
    new AppError("GEN_INVALID_DESIGN", `تصميم أداة لا يطابق العقد: ${detail}`, false, "warning"),

  duplicateToolName: (name: string) =>
    new AppError("GEN_DUPLICATE_TOOL_NAME", `اسم أداة مكرر في الدفعة: ${name}`, false, "warning"),

  unknownEndpoint: (operationId: string) =>
    new AppError(
      "GEN_UNKNOWN_ENDPOINT",
      `تصميم يشير إلى endpoint غير موجود في التحليل: ${operationId}`,
      false,
      "warning",
    ),

  unknownParameter: (toolName: string, param: string) =>
    new AppError(
      "GEN_UNKNOWN_PARAMETER",
      `الأداة ${toolName} تعلّم معاملاً لا يقابل حقلاً في جهة الطلب: ${param}`,
      false,
      "warning",
    ),

  unsupportedLocation: (toolName: string, param: string, location: string) =>
    new AppError(
      "GEN_UNSUPPORTED_LOCATION",
      `الأداة ${toolName} تستخدم موقع معامل غير مدعوم بعد (${location}): ${param}`,
      false,
      "warning",
    ),

  /** رفض التوليد عند مخطط أمن غير قابل للنمذجة — لا حماية ناقصة بصمت */
  unsupportedSecurity: (operationId: string, detail: string) =>
    new AppError(
      "GEN_UNSUPPORTED_SECURITY",
      `رفض التوليد: مخطط أمن غير مدعوم في العملية ${operationId} — ${detail}. لا يولَّد خادم بحماية ناقصة بصمت؛ صنّف النقطة غير قابلة للتوليد أو وسّع الدعم توثيقاً واختباراً`,
      false,
      "warning",
    ),

  /** حماية الكتابة على القرص */
  dirNotEmpty: (dir: string) =>
    new AppError(
      "GEN_DIR_NOT_EMPTY",
      `المجلد الهدف غير فارغ ورفضنا الطمس فوق عمل قائم: ${dir}`,
      false,
      "critical",
    ),
} as const;
