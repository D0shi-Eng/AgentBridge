/**
 * اختبارات وكيل المقيم EvaluatorAgent — البوابات والتغطية والمبررات.
 */

import { describe, expect, it } from "vitest";
import type { AnalyzedSpec, GeneratedServerArtifact, ToolDesign } from "@agentbridge/shared";
import { MockLlmProvider } from "@agentbridge/llm";
import { checkScoreCoverage, EvaluatorAgent } from "./evaluator-agent.js";

/** نسخة مصغرة مكتفية ذاتياً من المواصفة والتصاميم لأغراض هذا الملف فقط */
const analyzed: AnalyzedSpec = {
  spec: {
    title: "Petstore",
    openapiVersion: "3.0.0",
    endpointCount: 1,
    endpoints: [
      {
        path: "/pets/{petId}",
        method: "get",
        operationId: "showPetById",
        summary: "Returns a pet by ID",
        pathParams: ["petId"],
        requiresAuth: false,
        security: { alternatives: [], source: "none" as const, unsupported: [] },
        fields: [
          {
            pointer: "/paths/~1pets~1{petId}/get/parameters/0",
            name: "petId",
            location: "path",
            openApiType: "string",
            required: true,
          },
        ],
      },
    ],
  },
  kinds: {},
  risks: {},
  piiHits: [],
  mcpWorthyIds: ["showPetById"],
};

const designs: ToolDesign[] = [
  {
    name: "get_pet_by_id",
    description: "Retrieve one pet by its unique identifier.",
    endpointIds: ["showPetById"],
    parameters: { petId: { type: "string", required: true, description: "Pet id." } },
  },
];

const artifact: GeneratedServerArtifact = {
  files: [{ path: "manifest.json", contents: "{}" }],
  toolNames: designs.map((design) => design.name),
};

function validScores(): string {
  return JSON.stringify({
    scores: designs.map((design) => ({
      toolName: design.name,
      score: 90,
      reasons: ["وصف واضح ومباشر", "المعاملات كلها موثقة"],
    })),
  });
}

describe("EvaluatorAgent", () => {
  it("تقييم مكتمل التغطية يقبل من الدورة الأولى", async () => {
    const provider = new MockLlmProvider({ responses: [validScores()] });
    const result = await new EvaluatorAgent(provider).evaluate({
      artifact,
      designs,
      analyzed,
      tenantId: "t1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roundsUsed).toBe(1);
    expect(result.value.qualityScores).toHaveLength(1);
    expect(result.value.qualityScores[0]?.score).toBe(90);
  });

  it("تقييم فارغ التغطية يُغذى راجعاً ويُقبل في الدورة الثانية", async () => {
    const empty = JSON.stringify({ scores: [] });
    const provider = new MockLlmProvider({ responses: [empty, validScores()] });
    const result = await new EvaluatorAgent(provider).evaluate({
      artifact,
      designs,
      analyzed,
      tenantId: "t1",
    });
    expect(result.ok && result.value.roundsUsed === 2).toBe(true);
  });

  it("ثلاث دورات رديئة تنتهي بEVALUATION_ROUNDS_EXHAUSTED", async () => {
    const bad = '{"scores": "نص بدل مصفوفة"}';
    const provider = new MockLlmProvider({ responses: [bad, bad, bad] });
    const result = await new EvaluatorAgent(provider).evaluate({ artifact, designs, analyzed, tenantId: "t1" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("EVALUATION_ROUNDS_EXHAUSTED");
  });

  it("فشل المزود يمرر كما هو بلا التباس", async () => {
    const provider = new MockLlmProvider({});
    const result = await new EvaluatorAgent(provider).evaluate({ artifact, designs, analyzed, tenantId: "t1" });
    expect(result.ok).toBe(false);
  });

  it("سياق المحاكاة الجافة يصل في رسالة المستخدم", async () => {
    let captured = "";
    const provider = new MockLlmProvider({
      respond: (request) => {
        captured = request.messages[0]?.content ?? "";
        return validScores();
      },
    });
    await new EvaluatorAgent(provider).evaluate({ artifact, designs, analyzed, tenantId: "t1" });
    expect(captured).toContain("simulate_tool_call");
    expect(captured).toContain("constructible");
  });
});

describe("checkScoreCoverage — بوابة التغطية الحتمية", () => {
  const names = ["a_tool", "b_tool"];
  const scoreFor = (toolName: string, reasons = ["بند كافٍ للإثبات"]) => ({ toolName, score: 80, reasons });

  it("أداة بلا درجة ترفض وتذكر اسمها", () => {
    const result = checkScoreCoverage([scoreFor("a_tool")], names);
    expect(!result.ok && result.error.message.includes("b_tool")).toBe(true);
  });

  it("درجة لأداة غير موجودة ترفض", () => {
    const result = checkScoreCoverage([scoreFor("a_tool"), scoreFor("b_tool"), scoreFor("c_tool")], names);
    expect(!result.ok).toBe(true);
  });

  it("تكرار درجة نفس الأداة يرفض", () => {
    const result = checkScoreCoverage([scoreFor("a_tool"), scoreFor("a_tool")], names);
    expect(!result.ok).toBe(true);
  });

  it("بنود مبررة فارغة ترفض حتى لو سمح المخطط", () => {
    const result = checkScoreCoverage([{ ...scoreFor("a_tool"), reasons: [] }], ["a_tool"]);
    expect(!result.ok && result.error.message.includes("مبررة")).toBe(true);
  });
});
