/**
 * وكيل مصمم الأدوات DesignerAgent — العقد الثاني في وثيقة 04 (الأهم).
 *
 * المدخل: AnalyzedSpec. المخرج: ToolDesign[] عبر بوابتين إلزاميتين:
 *   بوابة المخطط (parseStructuredOutput) ثم البوابة المرجعية
 *   (validate_tool_design ضد التحليل الحتمي).
 *
 * الحلقة الداخلية (وثيقة 09): اقتراح ← فحص ← تغذية راجعة بالمواضع المخالفة
 * ← اقتراح جديد، بحد ثلاث دورات ثم فشل منظم قابل للإصلاح.
 * ملاحظة نطاق: التأسيس يتم بكتلة البيانات المحصورة في رسالة المستخدم،
 * والتحقق بأداة حتمية؛ الانتقاء التفاعلي متعدد الأدوات يكتمل مع مزود
 * حقيقي في جلسة الوكلاء الكاملة.
 */

import { createHash } from "node:crypto";
import type { AnalyzedSpec, TenantContext, ToolDesign } from "@agentbridge/shared";
import { ToolDesignSchema } from "@agentbridge/shared";
import { err, ok, type Result } from "@agentbridge/shared";
import type { LlmMessage, LlmProvider } from "@agentbridge/llm";
import { parseStructuredOutput } from "@agentbridge/llm";
import { z } from "zod";
import { AgentsErrors } from "./errors.js";
import {
  DESIGNER_SYSTEM_PROMPT,
  buildDesignerUserMessage,
} from "./prompts/designer-prompt.js";
import { checkToolDesign } from "./tools/validate-tool-design.js";
import type { FlywheelStore } from "@agentbridge/memory";

/** سقف دورات التصميم — محاذاة لسقف الإصلاح 3 في وثيقتي 04 و09 */
export const MAX_DESIGN_ROUNDS = 3;

/** مخطط عقد مخرج الوكيل — صارم: أي حقل زائد يرفض الدفعة كلها */
const DesignerOutputSchema = z
  .object({ designs: z.array(ToolDesignSchema).max(50) })
  .strict();
export type DesignerOutput = z.infer<typeof DesignerOutputSchema>;

export interface DesignPhaseInput {
  readonly analyzed: AnalyzedSpec;
  /** معرف المستأجر لأغراض السياق والتدقيق اللاحق */
  readonly tenantId: string;
}

export interface DesignPhaseResult {
  readonly designs: readonly ToolDesign[];
  readonly roundsUsed: number;
}

export class DesignerAgent {
  constructor(
    private readonly provider: LlmProvider,
    private readonly flywheel?: FlywheelStore,
  ) {}

  // هاش حتمي للمواصفة المحللة — يُستخدم مفتاحاً لدروس Flywheel
  private specHash(analyzed: AnalyzedSpec): string {
    const payload = JSON.stringify({ title: analyzed.spec.title, ids: analyzed.spec.endpoints.map((e) => e.operationId).sort() });
    return createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  async designTools(input: DesignPhaseInput): Promise<Result<DesignPhaseResult>> {
    const hash = this.specHash(input.analyzed);
    const context: TenantContext = { tenantId: input.tenantId, principal: { actorType: "service", authMethod: "api_key", subjectId: "internal:orchestrator", credentialId: "internal:orchestrator", tenantId: input.tenantId, permissions: ["flywheel:read"], authorizationVersion: 1 } };
    const lessons = this.flywheel !== undefined ? await this.flywheel.topK(context, hash, 3) : [];
    if (lessons.some((lesson) => lesson.tenantId !== context.tenantId)) throw new Error("رفض درس Flywheel من مستأجر مخالف");
    const lessonsContext = lessons.length > 0 ? `\n\n[دروس سابقة top-${lessons.length} للنمط ${hash}]: ${JSON.stringify(lessons.map((l: import("@agentbridge/memory").Lesson) => ({ specPattern: l.specPattern, designDecision: l.designDecision, outcome: l.outcome, score: l.score })))}` : "";
    const systemPrompt = `${DESIGNER_SYSTEM_PROMPT}${lessonsContext}`;
    const messages: LlmMessage[] = [
      { role: "user", content: buildDesignerUserMessage(input.analyzed) },
    ];

    for (let round = 1; round <= MAX_DESIGN_ROUNDS; round++) {
      const completion = await this.provider.complete({
        system: systemPrompt,
        messages,
        temperature: 0.2,
      });
      if (!completion.ok) return err(completion.error);

      // البوابة 2: تحقق المخطط الصارم
      const parsed = parseStructuredOutput(
        completion.value.text,
        DesignerOutputSchema,
        "DesignerAgent",
      );
      if (!parsed.ok) {
        this.pushFeedback(messages, completion.value.text, parsed.error.message);
        continue;
      }

      // فحص تفرد أسماء الأدوات داخل الدفعة (لا تكرار مسموح)
      const names = parsed.value.designs.map((design) => design.name);
      const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
      if (duplicated.length > 0) {
        this.pushFeedback(
          messages,
          completion.value.text,
          `أسماء أدوات مكررة: ${[...new Set(duplicated)].join("، ")}`,
        );
        continue;
      }

      // البوابة 3: الفحص المرجعي الحتمي لكل تصميم على حدة
      const allViolations = parsed.value.designs.flatMap(
        (design) => checkToolDesign(design, input.analyzed).violations,
      );
      if (allViolations.length === 0) {
        return ok({ designs: parsed.value.designs, roundsUsed: round });
      }
      this.pushFeedback(messages, completion.value.text, allViolations.join("؛ "));
    }

    return err(AgentsErrors.designRoundsExhausted(MAX_DESIGN_ROUNDS));
  }

  /** يحشر اقتراحاً فاشلاً وسببه في السياق ليصحح النموذج في الدورة التالية */
  private pushFeedback(messages: LlmMessage[], assistantRaw: string, reason: string): void {
    messages.push({ role: "assistant", content: assistantRaw });
    messages.push({
      role: "user",
      content: `رُفض مخرجك في بوابة التحقق. السبب: ${reason}. أعِد الإخراج JSON مطابقاً للعقد.`,
    });
  }
}
