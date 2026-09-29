/**
 * مصنع أخطاء حزمة hardening — امتداد لشجرة الأخطاء الموحدة.
 *
 * فشل الفحوص الساكنة ليس خطأً أصلاً (هو نتيجة موثقة في التقرير)؛
 * الخطأ هنا فقط عندما تعجز البنية نفسها عن إجراء الفحص.
 */

import { AppError } from "@agentbridge/shared";

export const HardErrors = {
  /** تعذر إقلاع الخادم المولد أو الاتصال به أثناء الفحوص الحية */
  liveProbesFailed: (detail: string) =>
    new AppError(
      "HARD_LIVE_PROBES_FAILED",
      `تعذر إكمال الفحوص الحية على الخادم المولد: ${detail}`,
      true,
      "warning",
    ),
} as const;
