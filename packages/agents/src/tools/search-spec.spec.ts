import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import { createSearchSpecTool } from "./search-spec.js";

const petstoreYaml = readFileSync(
  new URL("../../../../tests/fixtures/mini-petstore.yaml", import.meta.url),
  "utf8",
);

const parsed = parseOpenApiSpec(petstoreYaml);
if (!parsed.ok) throw new Error("تركيبة petstore يجب أن تُستوعب بنجاح");
const analyzed = analyzeSpec(parsed.value);

describe("أداة search_spec — بحث نصي حتمي", () => {
  const tool = createSearchSpecTool(analyzed);
  const ctx = { tenantId: "t1" };

  it("يجد المطابقات برمز استعلام واحد على operationId", async () => {
    const result = await tool.execute({ query: "pets" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.total).toBe(4); // كل العمليات عدا /health
      expect(result.value.matches.map((m) => m.operationId)).toContain("listPets");
    }
  });

  it("تضيق الرموز المتعددة نطاق البحث (و منطقية)", async () => {
    const result = await tool.execute({ query: "pets delete" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.total).toBe(1);
      expect(result.value.matches[0]?.operationId).toBe("deletePet");
    }
  });

  it("يعيد قائمة فارغة بلا فشل عند لا مطابقة", async () => {
    const result = await tool.execute({ query: "nonexistent" }, ctx);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.total).toBe(0);
  });

  it("يرفض الاستعلام القصير جداً عبر مخطط المدخل", async () => {
    const result = await tool.execute({ query: "x" }, ctx);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INVALID_INPUT");
  });

  it("حتمية: نفس الاستعلام يعطي نفس النتيجة بالترتيب نفسه", async () => {
    const a = await tool.execute({ query: "pet" }, ctx);
    const b = await tool.execute({ query: "pet" }, ctx);
    expect(a).toEqual(b);
  });
});
