/**
 * تجميع نتائج الفحوص الأمنية في تقرير SecurityReport الموحد.
 *
 * عقد الدرجة (موثق في docs/systems.md §4):
 *   - أي نتيجة حرجة واحدة = صفر نظافة (بوابة الرفض الحرجة في الشهادة).
 *   - وإلا: 100 − خصم كل فشل بحسب خطورته (high=25، medium=10، info=3).
 * الدرجة حد أدنى 0 — لا أرقام سالبة ولا تقريب.
 */

import { z } from "zod";
import type { SecurityFinding, SecurityReport } from "@agentbridge/shared";

/** تصنيفات الفحوص — تساعد المدقق لاحقاً على تجميع النتائج بعائلاتها */
export type SecurityCheckCategory =
  | "dangerous-code"
  | "secrets"
  | "injection"
  | "schema"
  | "errors"
  | "env"
  | "manifest"
  | "live";

/** مستوى الخطورة المعتمد — نفس شجرة shared */
type Severity = SecurityFinding["severity"];

/** نتيجة فحص أمني واحد قبل التجميع (النجاح أو الفشل صريحان) */
export interface SecurityCheckResult {
  /** معرف ثابت مثل HB-01 للفحوص الساكنة وHD-01 للحية */
  readonly id: string;
  /** عنوان الفحص بالعربية */
  readonly title: string;
  readonly category: SecurityCheckCategory;
  /** الخطورة التي تُسجَّل للنتيجة إن فشل الفحص */
  readonly severityIfFailed: Severity;
  readonly passed: boolean;
  /** موضع الإخفاق إن وجد (ملف/أداة/نداء) */
  readonly location?: string;
  /** شرح عربي موجز لسبب الفشل */
  readonly detail?: string;
}

/** مخطط نتيجة الفحص — بوابة الحقيقة على مخرجات runner sandbox */
export const SecurityCheckResultSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    category: z.enum(["dangerous-code", "manifest", "live"]),
    severityIfFailed: z.enum(["critical", "high", "medium", "info"]),
    passed: z.boolean(),
    location: z.string().optional(),
    detail: z.string().optional(),
  })
  .strict();

/** جدول الخصم حسب الخطورة — قرار مثبت قابل للاختبار */
const PENALTY: Readonly<Record<Exclude<Severity, "critical">, number>> = {
  high: 25,
  medium: 10,
  info: 3,
};

/** يحسب درجة النظافة من قائمة النتائج الفاشلة */
export function computeCleanlinessScore(results: readonly SecurityCheckResult[]): number {
  const failed = results.filter((result) => !result.passed);
  if (failed.some((result) => result.severityIfFailed === "critical")) return 0;
  const deduction = failed.reduce((sum, result) => {
    // الحرجة عادت صفراً أعلاه؛ هذا الفرع للنوع فقط
    if (result.severityIfFailed === "critical") return sum;
    return sum + PENALTY[result.severityIfFailed];
  }, 0);
  return Math.max(0, 100 - deduction);
}

/** يبني التقرير النهائي: النتائج الفاشلة تصبح SecurityFinding والباقي إحصاء */
export function buildSecurityReport(results: readonly SecurityCheckResult[]): SecurityReport {
  const findings: SecurityFinding[] = results
    .filter((result) => !result.passed)
    .map((result) => ({
      id: result.id,
      severity: result.severityIfFailed,
      title: result.title,
      ...(result.location !== undefined ? { location: result.location } : {}),
      ...(result.detail !== undefined ? { detail: result.detail } : {}),
    }));

  return {
    findings,
    totalChecks: results.length,
    passedCount: results.length - findings.length,
    hasCritical: findings.some((finding) => finding.severity === "critical"),
    cleanlinessScore: computeCleanlinessScore(results),
  };
}
