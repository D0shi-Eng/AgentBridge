import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import { createGetEndpointDetailsTool } from "./get-endpoint-details.js";

const petstoreYaml = readFileSync(
  new URL("../../../../tests/fixtures/mini-petstore.yaml", import.meta.url),
  "utf8",
);

const parsed = parseOpenApiSpec(petstoreYaml);
if (!parsed.ok) throw new Error("تركيبة petstore يجب أن تُستوعب بنجاح");
const analyzed = analyzeSpec(parsed.value);

describe("أداة get_endpoint_details — بوابة التأسيس", () => {
  const tool = createGetEndpointDetailsTool(analyzed);
  const ctx = { tenantId: "t1" };

  it("يعيد التفاصيل الكاملة لعملية معروفة", async () => {
    const result = await tool.execute({ operationId: "createPet" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.kind).toBe("write");
      expect(result.value.risk).toBe("high");
      expect(result.value.mcpWorthy).toBe(true);
      expect(result.value.requiresAuth).toBe(true);
      // حقول الطلب: name/tag/ownerPhone/category (المتداخلة تنضم بنقطة)
      const names = result.value.fields.map((f) => f.name);
      expect(names).toContain("name");
      expect(names).toContain("category.vetContactEmail");
    }
  });

  it("يحصر إصابات PII في النقطة المطلوبة وحدها", async () => {
    const createPet = await tool.execute({ operationId: "createPet" }, ctx);
    expect(createPet.ok && createPet.value.piiTypes).toContain("phone");

    const health = await tool.execute({ operationId: "getHealth" }, ctx);
    expect(health.ok && health.value.piiTypes).toHaveLength(0);
  });

  it("يرفض معرفاً مجهولاً برمز INVALID_INPUT", async () => {
    const result = await tool.execute({ operationId: "nope" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });
});
