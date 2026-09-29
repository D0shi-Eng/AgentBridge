/**
 * مصنع أخطاء حزمة agents — امتداد لشجرة الأخطاء الموحدة في shared.
 */

import { AppError } from "@agentbridge/shared";

export const AgentsErrors = {
  /** استنفاد دورات التصميم دون مخرج مطابق — يُحال لوكيل الإصلاح لاحقاً */
  designRoundsExhausted: (rounds: number) =>
    new AppError(
      "DESIGN_ROUNDS_EXHAUSTED",
      `استنفد وكيل المصمم ${rounds} دورات دون مخرج يجتاز بوابات الحقيقة`,
      true,
      "warning",
    ),

  /** استنفاد دورات التدقيق دون تقرير مغطٍ كامل */
  auditRoundsExhausted: (rounds: number) =>
    new AppError(
      "AUDIT_ROUNDS_EXHAUSTED",
      `استنفد وكيل المدقق ${rounds} دورات دون تقرير يجتاز بوابة التغطية`,
      true,
      "warning",
    ),

  /** خرج التدقيق لا يطابق النتائج الواصلة (نقص/تكرار/اختراع/تعديل حقول) */
  auditCoverage: (detail: string) =>
    new AppError(
      "AUDIT_COVERAGE_VIOLATION",
      `خرج التدقيق خالف بوابة التغطية: ${detail}`,
      true,
      "warning",
    ),

  /** استنفاد دورات التقييم دون درجات مكتملة التغطية ومبررة */
  evaluationRoundsExhausted: (rounds: number) =>
    new AppError(
      "EVALUATION_ROUNDS_EXHAUSTED",
      `استنفد وكيل المقيم ${rounds} دورات دون درجات تجتاز بوابات الحقيقة`,
      true,
      "warning",
    ),

  /** تغطية الدرجات ناقصة أو زائدة عن أدوات الـartifact */
  evaluationCoverage: (detail: string) =>
    new AppError(
      "EVALUATION_COVERAGE_VIOLATION",
      `درجات الجودة لا تطابق أدوات الخادم: ${detail}`,
      true,
      "warning",
    ),

  /** استنفاد دورات الإصلاح — تصعيد بشري وفق وثيقة 04 */
  repairRoundsExhausted: (rounds: number) =>
    new AppError(
      "REPAIR_ROUNDS_EXHAUSTED",
      `استُنفدت ${rounds} دورات إصلاح — التصعيد البشري إلزامي الآن`,
      false,
      "critical",
    ),

  /** ترقيع المصلح يستهدف ملفاً غير موجود في artifact — اختراع مرفوض */
  patchUnknownFile: (path: string) =>
    new AppError(
      "PATCH_UNKNOWN_FILE",
      `الترقيع يستهدف ملفاً غير موجود في artifact: ${path}`,
      false,
      "warning",
    ),

  /** الترقيع يمس نسبة من الملفات تتجاوز سقف التعديل الموضعي */
  patchTooBroad: (touched: number, total: number) =>
    new AppError(
      "PATCH_TOO_BROAD",
      `الترقيع يمس ${touched} من ${total} ملفات — تجاوز سقف التعديل الموضعي`,
      true,
      "warning",
    ),

  /** ترقيع بلا تبرير موثق — يخالف عقد المخرج */
  patchNoRationale: () =>
    new AppError(
      "PATCH_NO_RATIONALE",
      "ترقيع بلا بنود تبرير موثقة — مرفوض وفق عقد المخرج",
      true,
      "warning",
    ),
} as const;
