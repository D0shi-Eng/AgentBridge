/**
 * وكيل مقياس الجودة EvaluatorAgent — العقد الرابع في وثيقة 04.
 *
 * المدخل: تصاميم الأدوات + المواصفة المطبّعة (لمحاكاة النداءات).
 * المخرج: QualityScore[] — درجة 0–100 لكل أداة مع بنود مبررة.
 *
 * البوابات: مخطط Zod صارم ثم فحصا تغطية حتميان:
 *   1. كل أداة في الـartifact لها درجة واحدة بالضبط بلا زيادة.
 *   2. كل درجة تحمل بنود مبررة غير فارغة (حارس الوثيقة: بلا مبررات = رفض).
 * أي مخالفة تُغذى راجعة للنموذج ضمن سقف ثلاث دورات (وثيقة 09).
 */

import {
  QualityScoreSchema,
  err,
  ok,
  type AnalyzedSpec,
  type GeneratedServerArtifact,
  type QualityScore,
  type Result,
} from "@agentbridge/shared";
import type { LlmMessage, LlmProvider } from "@agentbridge/llm";
import { parseStructuredOutput } from "@agentbridge/llm";
import { z } from "zod";
import { AgentsErrors } from "./errors.js";
import { buildEvaluatorUserMessage, EVALUATOR_SYSTEM_PROMPT } from "./prompts/evaluator-prompt.js";
import { createSimulateToolCallTool } from "./tools/simulate-tool-call.js";

/** سقف دورات التقييم — محاذاة سقف الوكلاء في وثيقة 09 */
export const MAX_EVALUATION_ROUNDS = 3;

const EvaluatorOutputSchema = z
  .object({ scores: z.array(QualityScoreSchema).max(100) })
  .strict();
export type EvaluatorOutput = z.infer<typeof EvaluatorOutputSchema>;

export interface EvaluationPhaseInput {
  readonly artifact: GeneratedServerArtifact;
  /** التصاميم المرتبطة بالـartifact — مصدر بطاقات الأدوات ومحاكاة النداء */
  readonly designs: readonly ToolDesignAlias[];
  readonly analyzed: AnalyzedSpec;
  readonly tenantId: string;
}

/** اسم محلي لنوع التصميم — نفس نوع shared تماماً */
type ToolDesignAlias = import("@agentbridge/shared").ToolDesign;

export interface EvaluationPhaseResult {
  readonly qualityScores: readonly QualityScore[];
  readonly roundsUsed: number;
}

export class EvaluatorAgent {
  constructor(private readonly provider: LlmProvider) {}

  async evaluate(input: EvaluationPhaseInput): Promise<Result<EvaluationPhaseResult>> {
    const simulation = await this.buildSimulationSummary(input.designs, input.analyzed);

    const messages: LlmMessage[] = [
      { role: "user", content: buildEvaluatorUserMessage(input.designs, simulation) },
    ];

    for (let round = 1; round <= MAX_EVALUATION_ROUNDS; round++) {
      const completion = await this.provider.complete({
        system: EVALUATOR_SYSTEM_PROMPT,
        messages,
        temperature: 0,
      });
      if (!completion.ok) return err(completion.error);

      const parsed = parseStructuredOutput(
        completion.value.text,
        EvaluatorOutputSchema,
        "EvaluatorAgent",
      );
      if (!parsed.ok) {
        this.pushFeedback(messages, completion.value.text, parsed.error.message);
        continue;
      }

      // البوابتان المرجعيتان: التغطية الكاملة + وجود البنود المبررة
      const coverage = checkScoreCoverage(parsed.value.scores, input.artifact.toolNames);
      if (!coverage.ok) {
        this.pushFeedback(messages, completion.value.text, coverage.error.message);
        continue;
      }
      return ok({ qualityScores: parsed.value.scores, roundsUsed: round });
    }
    return err(AgentsErrors.evaluationRoundsExhausted(MAX_EVALUATION_ROUNDS));
  }

  /**
   * ملخص المحاكاة الجافة الحتمي: نداء نموذجي بأول قيمة سليمة لكل معامل
   * على كل أداة — يظهر للمقيم هل النداء قابل للبناء أم لا، بلا شبكة.
   */
  private async buildSimulationSummary(
    designs: readonly ToolDesignAlias[],
    analyzed: AnalyzedSpec,
  ): Promise<string> {
    if (designs.length === 0) return JSON.stringify({ simulations: [] });
    const simulator = createSimulateToolCallTool(designs, analyzed);
    const simulations: object[] = [];
    for (const design of designs) {
      const args: Record<string, string | number | boolean> = {};
      for (const [name, spec] of Object.entries(design.parameters)) {
        args[name] = spec.type === "number" ? 1 : spec.type === "boolean" ? true : "probe";
      }
      const result = await simulator.execute({ toolName: design.name, args }, { tenantId: "evaluate" });
      if (result.ok) {
        const plan: SimulatePlan = result.value;
        simulations.push({
          toolName: plan.toolName,
          constructible: plan.constructible,
          issues: plan.issues.map((issue) => issue.detail),
        });
      } else {
        simulations.push({ toolName: design.name, constructible: false, issues: [result.error.message] });
      }
    }
    return JSON.stringify({ simulations });
  }

  private pushFeedback(messages: LlmMessage[], assistantRaw: string, reason: string): void {
    messages.push({ role: "assistant", content: assistantRaw });
    messages.push({
      role: "user",
      content: `رُفض تقييمك في بوابة التحقق. السبب: ${reason}. أعِد الإخراج JSON مطابقاً للعقد.`,
    });
  }
}

/** شكل الخطة المطلوب من أداة المحاكاة — يوثق العقد بين الوكيل وأداته */
interface SimulatePlan {
  readonly toolName: string;
  readonly constructible: boolean;
  readonly issues: readonly { readonly detail: string }[];
}

/**
 * فحص التغطية الحتمي: كل اسم أداة له درجة واحدة بالضبط وبأي ترتيب،
 * وكل درجة تحمل بنوداً مبررة غير فارغة (الحارس الصريح في وثيقة 04).
 */
export function checkScoreCoverage(
  scores: readonly QualityScore[],
  toolNames: readonly string[],
): Result<void> {
  const expected = new Set(toolNames);
  const seen = new Set<string>();
  for (const score of scores) {
    if (!expected.has(score.toolName)) {
      return err(AgentsErrors.evaluationCoverage(`درجة لأداة غير موجودة: ${score.toolName}`));
    }
    if (seen.has(score.toolName)) {
      return err(AgentsErrors.evaluationCoverage(`أكثر من درجة للأداة: ${score.toolName}`));
    }
    seen.add(score.toolName);
    if (score.reasons.length === 0) {
      return err(AgentsErrors.evaluationCoverage(`درجة بلا بنود مبررة: ${score.toolName}`));
    }
  }
  const missing = toolNames.filter((name) => !seen.has(name));
  if (missing.length > 0) {
    return err(AgentsErrors.evaluationCoverage(`أدوات بلا درجة: ${missing.join("، ")}`));
  }
  return ok(undefined);
}
