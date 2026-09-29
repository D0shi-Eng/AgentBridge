/**
 * عقدة evaluate — جودة الأدوات بعيون المقيم + موثق المصادر الحتمي.
 *
 * التسلسل:
 *   1. EvaluatorAgent يعيد QualityScore[] عبر بواباته (مخطط + تغطية + مبررات).
 *   2. verifyCitations (البوابة 3) يفحص كل ادعاءات التصاميم ضد المواصفة.
 *   3. مخالفات استشهاد؟ needs_repair بتوصيات محددة — الترقيع يصلح الأوصاف.
 *   4. نظافة؟ completed وتُحفظ الدرجات للشهادة.
 */

import { EvaluatorAgent } from "@agentbridge/agents";
import { verifyCitations } from "@agentbridge/evaluator";
import { Errors } from "@agentbridge/shared";
import type { LlmProvider } from "@agentbridge/llm";
import type { NodeOutcome, PipelineNode } from "../graph.js";
import { isTransientError } from "../retry-policy.js";
import type { PipelineContext } from "../context-store.js";

export function createEvaluateNode(context: PipelineContext, provider: LlmProvider): PipelineNode {
  return {
    stage: "evaluate",
    kind: "agent",
    async run(): Promise<NodeOutcome> {
      const artifact = context.data.artifact;
      const analyzed = context.data.analyzed;
      const designs = context.data.designs;
      if (artifact === undefined || analyzed === undefined || designs === undefined) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.internal("evaluate بلا artifact/تحليل/تصاميم — تسلسل الرسم مكسور"),
        };
      }

      // 1) درجات الجودة من الوكيل ببواباته الكاملة
      const scored = await new EvaluatorAgent(provider).evaluate({
        artifact,
        designs,
        analyzed,
        tenantId: context.tenantId,
      });
      if (!scored.ok) {
        return { kind: "failed", fatal: !isTransientError(scored.error), error: scored.error };
      }

      // 2+3) موثق المصادر الحتمي — مخالفة واحدة تكفي لإحالة للإصلاح
      const citations = verifyCitations(designs, analyzed);
      if (!citations.ok) {
        return { kind: "failed", fatal: true, error: citations.error };
      }
      if (citations.value.violations.length > 0) {
        return {
          kind: "needs_repair",
          failure: {
            stage: "evaluate",
            summary: `موثق المصادر رصد ${citations.value.violations.length} مخالفة استشهاد`,
            attempt: context.repairCyclesUsed,
            findings: citations.value.violations.map((violation, index) => ({
              id: `CIT-${String(index + 1).padStart(2, "0")}`,
              severity: "medium" as const,
              title: "ادعاء بلا مصدر في تصميم أداة",
              location: violation.toolName,
              recommendedFix: violation.detail,
            })),
          },
        };
      }

      // 4) حفظ الدرجات للشهادة
      context.data.qualityScores = [...scored.value.qualityScores];
      const average = Math.round(
        scored.value.qualityScores.reduce((sum, score) => sum + score.score, 0) /
          Math.max(1, scored.value.qualityScores.length),
      );
      return {
        kind: "completed",
        summary: `قيّمت ${scored.value.qualityScores.length} أدوات بمتوسط جودة ${average}`,
        code: "evaluate.completed",
        params: { tools: scored.value.qualityScores.length, average },
      };
    },
  };
}
