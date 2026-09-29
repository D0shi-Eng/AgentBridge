/**
 * مصنع أخطاء حزمة evaluator — امتداد لشجرة الأخطاء الموحدة.
 *
 * الشهادة قرار ملزم؛ أي مدخل لا يمر ببوابة الحقيقة يرفض الإصدار
 * كلياً بدل إصدار شهادة مشكوك فيها.
 */

import { AppError } from "@agentbridge/shared";

export const CertErrors = {
  /** تقرير التحصين الواصل لا يطابق مخططه — رفض قبل أي حساب */
  invalidSecurityReport: (detail: string) =>
    new AppError(
      "CERT_INVALID_SECURITY_REPORT",
      `تقرير التحصين لا يطابق العقد فرفضت الشهادة قبل الحساب: ${detail}`,
      false,
      "warning",
    ),

  /** تقرير بلا فحوص منفذة لا يكفي لإصدار قرار قبول */
  noChecksExecuted: () =>
    new AppError(
      "CERT_NO_CHECKS_EXECUTED",
      "تقرير التحصين صفر فحوص — لا تصدر شهادة على هواء",
      false,
      "warning",
    ),

  /** درجات الجودة الواصلة مخالفة لعقدها */
  invalidQualityScores: (detail: string) =>
    new AppError(
      "CERT_INVALID_QUALITY_SCORES",
      `درجات الجودة لا تطابق العقد: ${detail}`,
      false,
      "warning",
    ),
} as const;
