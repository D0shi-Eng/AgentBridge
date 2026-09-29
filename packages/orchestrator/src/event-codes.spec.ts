/**
 * اختبارات أكواد الأحداث المستقرة في مخرجات المحرك.
 *
 * يثبت على رحلة كاملة ناجحة (بمزود mock اصطناعي):
 *   1. كل حدث يحمل كوداً يطابق النمط المستقر `مجال.حدث` (أحرف صغيرة/أرقام/_.).
 *   2. الأكواد المتوقعة على الرحلة السعيدة حاضرة (spec.received حتى certify.denied
 *      في وضع بلا فئات حية) ومعاملاتها أرقام/نصوص ASCII قصيرة حصراً.
 *   3. لا معامل تحمل نصاً مشتقاً من مواصفة العميل (عنوان المواصفة مثلاً) —
 *      المعاملات قناة عرض منظمة لا قناة بيانات.
 * الملخص العربي يبقى كما هو للسجلات (L1/تدقيق) — التغيير إضافي لا مُفسد.
 */

import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockLlmProvider, type LlmRequest } from "@agentbridge/llm";
import { EVENT_CODE_PATTERN, type PipelineEvent } from "@agentbridge/shared";
import { PipelineOrchestrator } from "./index.js";

const petstoreYaml = readFileSync(
  fileURLToPath(new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url)),
  "utf8",
);

const TMP_ROOT = fileURLToPath(new URL("../../../tests/e2e/.tmp/orchestrator-codes", import.meta.url)).replace(
  /[\\/]$/u,
  "",
);

/** دفعة تصميم أدنى صالحة — نفس النمط الموحد للرحلة الناجحة */
const VALID_BATCH = {
  designs: [
    {
      name: "list_pets",
      description: "List all pets in the store with an optional limit.",
      endpointIds: ["listPets"],
      parameters: { limit: { type: "number", required: false, description: "Max pets to return." } },
    },
  ],
} as const;

/** درجات مقيم وهمي لدفعة معينة */
function scoresResponse(batch: ReadonlyArray<{ name: string }>): string {
  return JSON.stringify({
    scores: batch.map((design) => ({ toolName: design.name, score: 95, reasons: ["وصف واضح"] })),
  });
}

/** موجّه حتمي يوزع الردود بحسب هوية الطالب */
function dispatcher(options: { designBatch: unknown; scores: string }) {
  return (request: LlmRequest): string => {
    if (request.system.includes("DesignerAgent")) return JSON.stringify(options.designBatch);
    return options.scores;
  };
}

describe.sequential("أكواد الأحداث المستقرة", () => {
  beforeAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("كل حدث في الرحلة السعيدة يحمل كوداً مستقراً ومعاملات آمنة", async () => {
    const provider = new MockLlmProvider({
      respond: dispatcher({ designBatch: VALID_BATCH, scores: scoresResponse(VALID_BATCH.designs) }),
    });
    const orchestrator = new PipelineOrchestrator({
      runId: "run-codes-happy",
      tenantId: "event-codes",
      rawSpec: petstoreYaml,
      provider,
      harden: { workDir: join(TMP_ROOT, "codes-happy"), liveProbes: false },
    });
    const summary = await orchestrator.run();
    expect(summary.finalStatus).toBe("completed");

    const events: readonly PipelineEvent[] = summary.events;
    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.code).toBeDefined();
      expect(event.code).toMatch(EVENT_CODE_PATTERN);
      // المعاملات أرقام أو نصوص ASCII قصيرة — لا قناة بيانات للنصوص الخام
      for (const [name, value] of Object.entries(event.params ?? {})) {
        expect(name).toMatch(/^[a-zA-Z][a-zA-Z0-9]{0,30}$/u);
        if (typeof value === "string") {
          expect(value).toMatch(/^[\x20-\x7E]{1,64}$/u);
        }
      }
    }
  });

  it("الأكواد المتوقعة على الرحلة السعيدة حاضرة بالترتيب المنطقي", async () => {
    const provider = new MockLlmProvider({
      respond: dispatcher({ designBatch: VALID_BATCH, scores: scoresResponse(VALID_BATCH.designs) }),
    });
    const orchestrator = new PipelineOrchestrator({
      runId: "run-codes-expected",
      tenantId: "event-codes",
      rawSpec: petstoreYaml,
      provider,
      harden: { workDir: join(TMP_ROOT, "codes-expected"), liveProbes: false },
    });
    const summary = await orchestrator.run();
    const codes = summary.events.map((event) => event.code);
    for (const expected of ["spec.received", "spec.normalized", "analyze.completed", "design.completed", "generate.completed", "harden.passed", "evaluate.completed"]) {
      expect(codes).toContain(expected);
    }
    // بلا فئات حية المنح مرفوض — قرار الشهادة يبقى حدثاً مكتملاً بكوده
    expect(codes).toContain("certify.denied");
    // حدث بدء مرحلة يسبق حدث اكتمالها لنفس المرحلة
    const firstStageStart = summary.events.findIndex((event) => event.code === "stage.started");
    const firstStageDone = summary.events.findIndex((event) => event.code === "spec.received");
    expect(firstStageStart).toBeGreaterThanOrEqual(0);
    expect(firstStageDone).toBeGreaterThan(firstStageStart);
  });

  it("معاملات certify تحمل الدرجة ورقم التحقق فقط — لا نصوص مواصفة", async () => {
    const provider = new MockLlmProvider({
      respond: dispatcher({ designBatch: VALID_BATCH, scores: scoresResponse(VALID_BATCH.designs) }),
    });
    const orchestrator = new PipelineOrchestrator({
      runId: "run-codes-certify",
      tenantId: "event-codes",
      rawSpec: petstoreYaml,
      provider,
      harden: { workDir: join(TMP_ROOT, "codes-certify"), liveProbes: false },
    });
    const summary = await orchestrator.run();
    const certifyEvent = summary.events.find((event) => event.code === "certify.denied");
    expect(certifyEvent).toBeDefined();
    expect(typeof certifyEvent?.params?.score).toBe("number");
    expect(certifyEvent?.params?.verificationId).toMatch(/^AB-[0-9a-f]{16}$/u);
    // عنوان المواصفة من yaml العميل لا يدخل المعاملات إطلاقاً
    expect(JSON.stringify(certifyEvent?.params ?? {})).not.toContain("Petstore");
  });
});
