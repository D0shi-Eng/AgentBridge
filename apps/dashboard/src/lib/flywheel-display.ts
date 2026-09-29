/**
 * مفسّر عرض دروس حلقة التعلّم — تحويل القيم التقنية المخزنة إلى تسميات مفهومة.
 *
 * ماهيته: دالة نقية تفك الصيغة الموثقة لعمود «القرار» التي يكتبها مسار
 * المعالجة (pipeline-executor: `tools:<الدرجة>:<بادئة معرف التحقق>` عند
 * وجود قرار شهادة، و`status:<حالة الإنهاء>` بدونه).
 * وظيفتها: لا تعرض `tools:96:AB-…` نصاً أساسياً غامضاً — تظهر تسمية عربية
 * ويبقى الخام متاحاً للتلميح والنسخ. الصيغة غير المعروفة تُعرض كما هي:
 * لا نغير معنى البيانات ولا نختلق وصفاً لها.
 */

import type { UiKey } from "./i18n";
import { t, type Locale } from "./i18n";

export type LessonDecisionView =
  | { readonly kind: "cert"; readonly label: string; readonly raw: string }
  | { readonly kind: "status"; readonly label: string; readonly raw: string }
  | { readonly kind: "raw"; readonly label: string; readonly raw: string };

/** حالات الإنهاء المترجمة المعروفة — ما عداه يُعرض خاماً */
const KNOWN_STATUS: ReadonlyMap<string, UiKey> = new Map([
  ["completed", "status.completed"],
  ["failed", "status.failed"],
  ["suspended", "status.suspended"],
]);

export function lessonDecisionView(designDecision: string, locale: Locale): LessonDecisionView {
  // الصيغة الموثقة: tools:<score 0-100>:AB-xxxxxxxx — "tools" اسم تاريخي
  // خادع في المصدر لكنه يحمل الدرجة لا عدد الأدوات، والعرض يسميها بحقيقتها
  const cert = /^tools:(\d{1,3}):(AB-.+)$/u.exec(designDecision);
  if (cert !== null) {
    const scoreRaw = cert[1] ?? "";
    const vidRaw = cert[2] ?? "";
    const score = Number(scoreRaw);
    if (score >= 0 && score <= 100) {
      return {
        kind: "cert",
        label: t("flywheel.decisionCert", locale, { score: scoreRaw, vid: vidRaw }),
        raw: designDecision,
      };
    }
  }
  const status = /^status:(.+)$/u.exec(designDecision);
  if (status !== null) {
    const statusRaw = status[1] ?? "";
    const known = KNOWN_STATUS.get(statusRaw);
    if (known !== undefined) {
      return { kind: "status", label: t("flywheel.decisionStatus", locale, { status: t(known, locale) }), raw: designDecision };
    }
  }
  return { kind: "raw", label: designDecision, raw: designDecision };
}
