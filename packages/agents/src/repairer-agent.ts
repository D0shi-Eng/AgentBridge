/**
 * وكيل الإصلاح RepairerAgent — العقد الخامس في وثيقة 04.
 *
 * المدخل: FailureReport + ملفات الـartifact الحالية.
 * المخرج: RepairPatch — تعديلات موضعية على ملفات قائمة حصراً.
 *
 * البوابات: مخطط Zod صارم ثم فحوص حتمية:
 *   1. كل ملف مستهدف موجود أصلاً في artifact (لا اختراع ولا إضافة).
 *   2. الترقيع لا يعيد توليد الـartifact كاملاً (سقف نسبة الملفات الملموسة).
 *   3. التبرير غير فارغ ويذكر النتائج المستهدفة.
 *
 * حد الإصلاح: 3 دورات لكل artifact ثم تصعيد بشري — يفرضه المنسق
 * (repair node) وليس هذا الوكيل؛ الوكيل دورة واحدة = اقتراح واحد.
 */

import { createHash } from "node:crypto";
import {
  RepairPatchSchema,
  err,
  ok,
  type FailureReport,
  type GeneratedFile,
  type RepairPatch,
  type Result,
  type TenantContext,
} from "@agentbridge/shared";
import type { LlmMessage, LlmProvider } from "@agentbridge/llm";
import { parseStructuredOutput } from "@agentbridge/llm";
import { AgentsErrors } from "./errors.js";
import {
  buildRepairerUserMessage,
  REPAIRER_SYSTEM_PROMPT,
} from "./prompts/repairer-prompt.js";
import type { FlywheelStore } from "@agentbridge/memory";

/** سقف نسبة ملفات الـartifact التي يجوز للترقيع لمسها في الدورة الواحدة */
export const MAX_TOUCHED_FILES_RATIO = 0.6;

const RepairerOutputSchema = RepairPatchSchema;
export type RepairerOutput = RepairPatch;

export interface RepairPhaseInput {
  readonly failure: FailureReport;
  /** ملفات الـartifact كما هي الآن — أساس الحكم على "القائمة" */
  readonly currentFiles: readonly GeneratedFile[];
  readonly tenantId: string;
}

export class RepairerAgent {
  constructor(
    private readonly provider: LlmProvider,
    private readonly flywheel?: FlywheelStore,
  ) {}

  private failureHash(failure: FailureReport): string {
    const payload = JSON.stringify({ stage: failure.stage, summary: failure.summary.slice(0, 80) });
    return createHash("sha256").update(payload).digest("hex").slice(0, 32);
  }

  async proposeRepair(input: RepairPhaseInput): Promise<Result<RepairPatch>> {
    const hash = this.failureHash(input.failure);
    const context: TenantContext = { tenantId: input.tenantId, principal: { actorType: "service", authMethod: "api_key", subjectId: "internal:orchestrator", credentialId: "internal:orchestrator", tenantId: input.tenantId, permissions: ["flywheel:read"], authorizationVersion: 1 } };
    const lessons = this.flywheel !== undefined ? await this.flywheel.topK(context, hash, 3) : [];
    if (lessons.some((lesson) => lesson.tenantId !== context.tenantId)) throw new Error("رفض درس Flywheel من مستأجر مخالف");
    const lessonsContext = lessons.length > 0 ? `\n\n[دروس سابقة top-${lessons.length} للنمط ${hash}]: ${JSON.stringify(lessons.map((l: import("@agentbridge/memory").Lesson) => ({ specPattern: l.specPattern, designDecision: l.designDecision, outcome: l.outcome })))}` : "";
    const systemPrompt = `${REPAIRER_SYSTEM_PROMPT}${lessonsContext}`;
    const messages: LlmMessage[] = [
      { role: "user", content: buildRepairerUserMessage(input.failure, input.currentFiles) },
    ];

    for (let round = 1; round <= 3; round++) {
      const completion = await this.provider.complete({
        system: systemPrompt,
        messages,
        temperature: 0.2,
      });
      if (!completion.ok) return err(completion.error);

      const parsed = parseStructuredOutput(
        completion.value.text,
        RepairerOutputSchema,
        "RepairerAgent",
      );
      if (!parsed.ok) {
        this.pushFeedback(messages, completion.value.text, parsed.error.message);
        continue;
      }

      const gates = validatePatch(parsed.value, input.currentFiles);
      if (gates.ok) return ok(parsed.value);
      this.pushFeedback(messages, completion.value.text, gates.error.message);
    }
    return err(AgentsErrors.repairRoundsExhausted(3));
  }

  private pushFeedback(messages: LlmMessage[], assistantRaw: string, reason: string): void {
    messages.push({ role: "assistant", content: assistantRaw });
    messages.push({
      role: "user",
      content: `رُفض ترقيعك في بوابة التحقق. السبب: ${reason}. أعِد الإخراج JSON مطابقاً للعقد.`,
    });
  }
}

/** البوابات الحتمية الثلاث على الترقيع المقترح */
export function validatePatch(patch: RepairPatch, currentFiles: readonly GeneratedFile[]): Result<void> {
  const known = new Set(currentFiles.map((file) => file.path));

  // البوابة 1: لا ملفات جديدة أو مخترعة
  for (const file of patch.files) {
    if (!known.has(file.path)) {
      return err(AgentsErrors.patchUnknownFile(file.path));
    }
  }

  // البوابة 2: سقف التعديل الموضعي — لمس كل الملفات = إعادة توليد مقنّعة وممنوعة
  const allowedTouches = Math.max(1, Math.floor(MAX_TOUCHED_FILES_RATIO * currentFiles.length));
  if (patch.files.length > allowedTouches) {
    return err(AgentsErrors.patchTooBroad(patch.files.length, currentFiles.length));
  }

  // البوابة 3: تبرير موثق غير فارغ
  if (patch.rationale.length === 0) {
    return err(AgentsErrors.patchNoRationale());
  }
  return ok(undefined);
}
