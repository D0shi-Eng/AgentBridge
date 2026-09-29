/**
 * اختبارات مزود Anthropic — بعميل مزيف (لا شبكة).
 *
 * ثلاث حالات:
 * 1) نجاح مع usage → نص وusage وتكلفة محسوبة صحيحاً
 * 2) خطأ شبكة → Result.err retryable
 * 3) خرج غير JSON → يمر عبر parseStructuredOutput ويفشل بلا صمت
 */

import { describe, expect, it } from "vitest";
import z from "zod";
import { AnthropicProvider, estimateAnthropicCostUsd } from "./anthropic-provider.js";
import { parseStructuredOutput } from "./structured-output.js";

function fakeAnthropicClient(response: unknown, shouldThrow = false) {
  return {
    messages: {
      create: async () => {
        if (shouldThrow) throw new Error("network down");
        return response as never;
      },
    },
  } as never;
}

describe("AnthropicProvider", () => {
  it("نجاح: يعيد النص وusage ويحسب التكلفة صحيحاً", async () => {
    const response = {
      content: [{ type: "text", text: '{"designs":[]}' }],
      usage: { input_tokens: 1_000_000, output_tokens: 500_000 },
    };
    const provider = new AnthropicProvider("sk-test", { client: fakeAnthropicClient(response) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "صمم" }] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('{"designs":[]}');
      expect(result.value.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 500_000 });
      // جدول: sonnet input 3 + output 15 → 1M*3 + 0.5M*15 = 3 + 7.5 = 10.5$
      const cost = estimateAnthropicCostUsd(result.value.usage!, "claude-3-5-sonnet-20241022");
      expect(cost).toBeCloseTo(10.5, 5);
    }
  });

  it("خطأ شبكة → Result.err retryable", async () => {
    const provider = new AnthropicProvider("sk-test", { client: fakeAnthropicClient(null, true) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "صمم" }] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_PROVIDER_FAILED");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("خرج غير JSON → يمر عبر parseStructuredOutput ويفشل بلا صمت", async () => {
    const response = {
      content: [{ type: "text", text: "not-json-at-all" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const provider = new AnthropicProvider("sk-test", { client: fakeAnthropicClient(response) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "صمم" }] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const schema = z.object({ designs: z.array(z.unknown()) });
      const parsed = parseStructuredOutput(result.value.text, schema, "DesignerAgent");
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) {
        expect(parsed.error.code).toBe("LLM_OUTPUT_INVALID");
      }
    }
  });

  it("استجابة فارغة → emptyResponse", async () => {
    const response = {
      content: [{ type: "text", text: "   " }],
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const provider = new AnthropicProvider("sk-test", { client: fakeAnthropicClient(response) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "صمم" }] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_EMPTY_RESPONSE");
  });

  it("يمرر temperature وmaxOutputTokens ويحسب تكلفة نموذج غير معروف بالافتراضي", async () => {
    const response = {
      content: [{ type: "text", text: '{"designs":[]}' }],
      usage: { input_tokens: 100, output_tokens: 100 },
    };
    let captured: unknown = null;
    const client = {
      messages: {
        create: async (params: unknown) => {
          captured = params;
          return response as never;
        },
      },
    } as never;
    const provider = new AnthropicProvider("sk-test", { model: "unknown-model", client });
    const result = await provider.complete({
      system: "نظام",
      messages: [{ role: "user", content: "صمم" }],
      temperature: 0.2,
      maxOutputTokens: 512,
    });
    expect(result.ok).toBe(true);
    const params = captured as { temperature?: number; max_tokens?: number };
    expect(params.temperature).toBe(0.2);
    expect(params.max_tokens).toBe(512);
    // نموذج غير معروف يستخدم DEFAULT_PRICE (3/15)
    const cost = estimateAnthropicCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, "unknown-model");
    expect(cost).toBeCloseTo(18, 5);
  });

  it("محتوى غير نصي → emptyResponse", async () => {
    const response = {
      content: [{ type: "image", text: "" }],
      usage: { input_tokens: 10, output_tokens: 10 },
    };
    const provider = new AnthropicProvider("sk-test", { client: fakeAnthropicClient(response) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "صمم" }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_EMPTY_RESPONSE");
  });
});
