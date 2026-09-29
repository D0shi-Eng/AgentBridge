/**
 * الرسم البياني التنفيذي — عقد المراحل ونتائجها (وثيقة 09).
 *
 * DAG حتمي بالترتيب الخطي الثماني؛ العقدة الواحدة إما حتمية أو وكيلية،
 * وكلها idempotent: نفس المدخلات = نفس النتيجة (مفتاح الفحص بصمة المدخلات).
 *
 * NodeOutcome الأنواع الأربعة الموثقة:
 *   completed | failed(قابل للإعادة) | failed(fatal) | needs_repair
 */

import type { AppError, FailureReport, StageId } from "@agentbridge/shared";

/**
 * نتيجة تنفيذ عقدة واحدة — لغة الحوار بين العقد والمحرك.
 * النتيجة المكتملة تحمل code/params اختياريين للعرض المترجم —
 * الملخص العربي يبقى للسجلات (L1/تدقيق) ولا يُعرض خاماً في واجهة EN.
 */
export type NodeOutcome =
  | {
      readonly kind: "completed";
      readonly summary: string;
      /** كود الحدث المستقر للعرض المترجم */
      readonly code?: string;
      /** معاملات منظمة (أرقام/أكواد تقنية حصراً — لا نصوص عميل) */
      readonly params?: Readonly<Record<string, string | number>>;
    }
  | { readonly kind: "failed"; readonly fatal: boolean; readonly error: AppError }
  | { readonly kind: "needs_repair"; readonly failure: FailureReport };

/** العقدة الواحدة في الرسم البياني — مطابقة لعقد PipelineNode في وثيقة 09 */
export interface PipelineNode {
  /** معرف المرحلة التي تملكها هذه العقدة */
  readonly stage: StageId;
  /** هل تستدعي LLM؟ (تحكم بالتكلفة والحتمية) */
  readonly kind: "deterministic" | "agent";
  run(): Promise<NodeOutcome>;
}

/** الترتيب التنفيذي الملزم — نفس ترتيب StageIds في shared */
export const EXECUTION_ORDER: readonly StageId[] = [
  "load_spec",
  "normalize",
  "analyze",
  "design_tools",
  "generate_server",
  "harden",
  "evaluate",
  "certify",
] as const;

/** المراحل التي يجوز أن يُوقف إليها الإصلاح (فشل على مستوى الـartifact) */
export const REPAIRABLE_STAGES: readonly StageId[] = ["harden", "evaluate"] as const;

export function isRepairableStage(stage: StageId): boolean {
  return REPAIRABLE_STAGES.includes(stage);
}
