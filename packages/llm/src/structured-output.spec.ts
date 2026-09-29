import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractJsonBlock, parseStructuredOutput } from "./structured-output.js";

describe("extractJsonBlock", () => {
  it("ينزع أسوار json ويعيد المحتوى", () => {
    const result = extractJsonBlock('سابق ```json\n{"a":1}\n``` لاحق');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('{"a":1}');
  });

  it("يقبل JSON مجرداً بلا أسوار", () => {
    const result = extractJsonBlock('  {"a":1}  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('{"a":1}');
  });

  it("يرفض النص الفارغ برمز LLM_OUTPUT_INVALID", () => {
    const result = extractJsonBlock("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_OUTPUT_INVALID");
  });
});

describe("parseStructuredOutput — بوابة الحقيقة الثانية", () => {
  const schema = z.object({ name: z.string(), count: z.number().int() }).strict();

  it("يقبل خرجاً مطابقاً للمخطط داخل أسوار", () => {
    const raw = '```json\n{"name":"list_pets","count":3}\n```';
    const result = parseStructuredOutput(raw, schema, "tester");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ name: "list_pets", count: 3 });
  });

  it("يرفض JSON غير صالح الصيغة", () => {
    const result = parseStructuredOutput("{not json}", schema, "tester");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_OUTPUT_INVALID");
  });

  it("يرفض خرجاً مخالفاً للمخطط مع ذكر المخالفة", () => {
    const result = parseStructuredOutput('{"name":1,"count":3}', schema, "tester");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_OUTPUT_INVALID");
      // الرسالة تحمل اسم الوكيل وموضع المخالفة لتوجيه وكيل الإصلاح
      expect(result.error.message).toContain("tester");
      expect(result.error.message).toContain("name");
    }
  });

  it("يرفض حقولاً زائدة عن المخطط الصارم", () => {
    const result = parseStructuredOutput(
      '{"name":"x","count":1,"extra":true}',
      schema,
      "tester",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_OUTPUT_INVALID");
  });

  it("يرفض نصاً فارغاً حتى لو كان المخطط سيتقبل undefined", () => {
    const looseSchema = z.string();
    const result = parseStructuredOutput("", looseSchema, "tester");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_OUTPUT_INVALID");
  });
});
