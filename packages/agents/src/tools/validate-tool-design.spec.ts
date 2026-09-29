import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import type { ToolDesign } from "@agentbridge/shared";
import { createValidateToolDesignTool, checkToolDesign } from "./validate-tool-design.js";

const petstoreYaml = readFileSync(
  new URL("../../../../tests/fixtures/mini-petstore.yaml", import.meta.url),
  "utf8",
);

const parsed = parseOpenApiSpec(petstoreYaml);
if (!parsed.ok) throw new Error("تركيبة petstore يجب أن تُستوعب بنجاح");
const analyzed = analyzeSpec(parsed.value);

/** تصميم سليم مرجعي على showPetById (معامل مسار petId إلزامي) */
const goodDesign: ToolDesign = {
  name: "get_pet_by_id",
  description: "Retrieve a single pet by its unique identifier.",
  endpointIds: ["showPetById"],
  parameters: {
    petId: {
      type: "string",
      required: true,
      description: "Unique identifier of the pet to fetch.",
    },
  },
};

describe("أداة validate_tool_design — البوابة المرجعية", () => {
  const tool = createValidateToolDesignTool(analyzed);
  const ctx = { tenantId: "t1" };

  it("يقبل التصميم السليم بلا أي مخالفات", async () => {
    const result = await tool.execute(goodDesign, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.valid).toBe(true);
      expect(result.value.violations).toHaveLength(0);
    }
  });

  it("يكشف endpoint وهمياً (هلوسة) بالرمز ENDPOINT_NOT_FOUND", async () => {
    const output = checkToolDesign(
      { ...goodDesign, endpointIds: ["makeMeRich"] },
      analyzed,
    );
    expect(output.valid).toBe(false);
    expect(output.violations).toContain("ENDPOINT_NOT_FOUND:makeMeRich");
  });

  it("يرفض نقطة غير مرشحة للجدوى (البنية التشغيلية)", async () => {
    const output = checkToolDesign({ ...goodDesign, endpointIds: ["getHealth"] }, analyzed);
    expect(output.violations).toContain("ENDPOINT_NOT_MCP_WORTHY:getHealth");
  });

  it("يكشف معاملاً لا يقابل حقلاً حقيقياً", async () => {
    const output = checkToolDesign(
      {
        ...goodDesign,
        parameters: {
          ...goodDesign.parameters,
          fakeParam: { type: "string", required: false, description: "x".repeat(12) },
        },
      },
      analyzed,
    );
    expect(output.violations).toContain("UNKNOWN_PARAMETER:fakeParam");
  });

  it("يرفض معاملاً من حقول الاستجابة (ownerCreditCard في Pet المستعادة)", async () => {
    const output = checkToolDesign(
      {
        ...goodDesign,
        parameters: {
          ownerCreditCard: { type: "string", required: true, description: "x".repeat(12) },
        },
      },
      analyzed,
    );
    expect(output.violations).toContain("UNKNOWN_PARAMETER:ownerCreditCard");
  });

  it("يطالب بمعامل المسار الإلزامي للنقطة الأساسية", async () => {
    const withoutParam: ToolDesign = { ...goodDesign, parameters: {} };
    const output = checkToolDesign(withoutParam, analyzed);
    expect(output.violations).toContain("MISSING_PATH_PARAM:petId");
  });

  it("يرفض الدمج فوق سقف الخمسة endpoints", async () => {
    const ids = ["listPets", "createPet", "showPetById", "deletePet", "getHealth", "extra"];
    const output = checkToolDesign({ ...goodDesign, endpointIds: ids }, analyzed);
    expect(output.violations.some((v) => v.startsWith("TOO_MANY_ENDPOINTS"))).toBe(true);
  });
});
