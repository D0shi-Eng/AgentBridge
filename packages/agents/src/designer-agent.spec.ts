import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import { MockLlmProvider } from "@agentbridge/llm";
import type { AnalyzedSpec } from "@agentbridge/shared";
import { DesignerAgent, MAX_DESIGN_ROUNDS } from "./designer-agent.js";
import { VALID_BATCH, json } from "./designer-agent-fixtures.js";

const petstoreYaml = readFileSync(
  new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url),
  "utf8",
);

const parsed = parseOpenApiSpec(petstoreYaml);
if (!parsed.ok) throw new Error("تركيبة petstore يجب أن تُستوعب بنجاح");
const analyzed: AnalyzedSpec = analyzeSpec(parsed.value);


describe("DesignerAgent — الحلقة والبوابات", () => {
  const ctxInput = { analyzed, tenantId: "t1" };

  it("يقبل دفعة سليمة من المحاولة الأولى", async () => {
    const provider = new MockLlmProvider({ responses: [json(VALID_BATCH)] });
    const result = await new DesignerAgent(provider).designTools(ctxInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.roundsUsed).toBe(1);
      expect(result.value.designs.map((d) => d.name)).toEqual([
        "list_pets",
        "create_pet",
        "get_pet_by_id",
        "delete_pet",
      ]);
    }
  });

  it("يصحح مخرجاً مخالفاً للمخطط في دورة ثانية", async () => {
    const broken = json({
      designs: [{ ...VALID_BATCH.designs[0], name: "Not Snake Case!" }],
    });
    const provider = new MockLlmProvider({ responses: [broken, json(VALID_BATCH)] });
    const result = await new DesignerAgent(provider).designTools(ctxInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.roundsUsed).toBe(2);
  });

  it("يصحح هلوسة endpoint في دورة ثانية عبر البوابة المرجعية", async () => {
    const hallucinated = json({
      designs: [{ ...VALID_BATCH.designs[2], endpointIds: ["getPetById"] }],
    });
    const provider = new MockLlmProvider({ responses: [hallucinated, json(VALID_BATCH)] });
    const result = await new DesignerAgent(provider).designTools(ctxInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.roundsUsed).toBe(2);
  });

  it("يرفض أسماء مكررة داخل الدفعة ثم يصحح", async () => {
    const dupBatch = json({
      designs: [
        VALID_BATCH.designs[0],
        { ...VALID_BATCH.designs[1], name: "list_pets" },
      ],
    });
    const provider = new MockLlmProvider({ responses: [dupBatch, json(VALID_BATCH)] });
    const result = await new DesignerAgent(provider).designTools(ctxInput);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.roundsUsed).toBe(2);
  });

  it("يفشل خطأً منظماً عند استنفاد كل الدورات بمخرج فاسد", async () => {
    const provider = new MockLlmProvider({ respond: () => "لست json أبداً" });
    const result = await new DesignerAgent(provider).designTools(ctxInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("DESIGN_ROUNDS_EXHAUSTED");
  });

  it("ينشر فشل المزود كما هو دون ابتلاع", async () => {
    const provider = new MockLlmProvider(); // بلا طابور ولا دالة
    const result = await new DesignerAgent(provider).designTools(ctxInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_EMPTY_RESPONSE");
  });

  it("السقف الموثق ثلاث دورات", () => {
    expect(MAX_DESIGN_ROUNDS).toBe(3);
  });
});

describe("DesignerAgent — حقن Flywheel L4 (S12-A)", () => {
  it("يحقن دروس topK في مطالب النظام قبل الاستدعاء", async () => {
    const { createHash } = await import("node:crypto");
    let capturedSystem = "";
    const provider = new MockLlmProvider({
      respond: (req: { system: string }) => {
        capturedSystem = req.system;
        return json({ designs: [{ name: "get_pet", description: "وصف كافٍ للاختبار هنا يزيد عن عشرة", endpointIds: ["getPet"], parameters: {} }] });
      },
    });
    const lessons: import("@agentbridge/memory").Lesson[] = [
      { specPattern: "hash-test", designDecision: "قرار سابق", outcome: "success", score: 99, tenantId: "t1", createdAt: new Date().toISOString() },
    ];
    const analyzedMini = {
      spec: { title: "Pet", endpoints: [{ operationId: "getPet", method: "get", path: "/pet/{id}", summary: "g", requiresAuth: false, fields: [{ name: "id", location: "path", openApiType: "string", required: true, pointer: "" }] }] },
      kinds: { getPet: "read" },
      risks: {},
      mcpWorthyIds: ["getPet"],
    } as unknown as AnalyzedSpec;
    const expectedHash = createHash("sha256").update(JSON.stringify({ title: "Pet", ids: ["getPet"] })).digest("hex").slice(0, 32);
    const flywheel: import("@agentbridge/memory").FlywheelStore = {
      saveLesson: async () => undefined,
      topK: async (context, query) => (
        context.tenantId === "t1" && query === expectedHash ? lessons : []
      ),
      listRecent: async () => [],
      deleteLesson: async () => undefined,
      analytics: async () => ({ totalLessons: 0, avgScore: 0, successRate: 0, successCount: 0, histogram: [0, 0, 0, 0, 0], topPatterns: [], trend: [] }),
    };
    const agent = new DesignerAgent(provider, flywheel);
    const result = await agent.designTools({ analyzed: analyzedMini, tenantId: "t1" });
    expect(result.ok).toBe(true);
    expect(capturedSystem).toContain("قرار سابق");
    expect(capturedSystem).toContain(expectedHash);
  });

  it("يرفض درساً من مستأجر مخالف حتى لو أعاده adapter خاطئاً", async () => {
    const provider = new MockLlmProvider({
      respond: () => json({ designs: [{ name: "get_pet", description: "وصف كافٍ للاختبار هنا يزيد عن عشرة", endpointIds: ["getPet"], parameters: {} }] }),
    });
    const crossTenant: import("@agentbridge/memory").Lesson[] = [
      { specPattern: "hash-test", designDecision: "درس مستأجر آخر", outcome: "success", score: 99, tenantId: "tenant-B", createdAt: new Date().toISOString() },
    ];
    const flywheel: import("@agentbridge/memory").FlywheelStore = {
      saveLesson: async () => undefined,
      // adapter معيب يخصّ مهماً درساً من tenant-B رغم السياق t1 — يجب أن يفشل النداء
      topK: async () => crossTenant,
      listRecent: async () => [],
      deleteLesson: async () => undefined,
      analytics: async () => ({ totalLessons: 0, avgScore: 0, successRate: 0, successCount: 0, histogram: [0, 0, 0, 0, 0], topPatterns: [], trend: [] }),
    };
    const agent = new DesignerAgent(provider, flywheel);
    await expect(agent.designTools({ analyzed: analyzed, tenantId: "t1" })).rejects.toThrow(/مستأجر مخالف/u);
  });
});
