/**
 * اختبارات مزود OpenAI — بعميل مزيف (لا شبكة).
 */

import { describe, expect, it } from "vitest";
import z from "zod";
import { estimateOpenaiCostUsd, OpenAIProvider } from "./openai-provider.js";
import { parseStructuredOutput } from "./structured-output.js";

function fakeOpenaiClient(response: unknown, shouldThrow = false) {
  return {
    chat: {
      completions: {
        create: async (_params: unknown) => {
          if (shouldThrow) throw new Error("network down");
          return response as never;
        },
      },
    },
  } as never;
}

describe("OpenAIProvider", () => {
  it("نجاح: يعيد النص وusage ويحسب التكلفة صحيحاً", async () => {
    const response = {
      choices: [{ message: { content: '{"scores":[]}' } }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 500_000 },
    };
    const provider = new OpenAIProvider("sk-test", { client: fakeOpenaiClient(response) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "قيّم" }] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('{"scores":[]}');
      expect(result.value.usage).toEqual({ inputTokens: 1_000_000, outputTokens: 500_000 });
      // gpt-4o input 2.5 + output 10 → 2.5 + 5 = 7.5$
      const cost = estimateOpenaiCostUsd(result.value.usage!, "gpt-4o");
      expect(cost).toBeCloseTo(7.5, 5);
    }
  });

  it("خطأ شبكة → Result.err retryable", async () => {
    const provider = new OpenAIProvider("sk-test", { client: fakeOpenaiClient(null, true) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "قيّم" }] });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_PROVIDER_FAILED");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("خرج غير JSON → يمر عبر parseStructuredOutput ويفشل بلا صمت", async () => {
    const response = {
      choices: [{ message: { content: "not-json" } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    };
    const provider = new OpenAIProvider("sk-test", { client: fakeOpenaiClient(response) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "قيّم" }] });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const schema = z.object({ scores: z.array(z.unknown()) });
      const parsed = parseStructuredOutput(result.value.text, schema, "EvaluatorAgent");
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.code).toBe("LLM_OUTPUT_INVALID");
    }
  });

  it("استجابة فارغة → emptyResponse", async () => {
    const response = {
      choices: [{ message: { content: "   " } }],
      usage: { prompt_tokens: 10, completion_tokens: 10 },
    };
    const provider = new OpenAIProvider("sk-test", { client: fakeOpenaiClient(response) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "قيّم" }] });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_EMPTY_RESPONSE");
  });

  it("يمرر temperature وmaxOutputTokens ويحسب تكلفة نموذج غير معروف بالافتراضي", async () => {
    const response = {
      choices: [{ message: { content: '{"scores":[]}' } }],
      usage: { prompt_tokens: 100, completion_tokens: 100 },
    };
    let captured: unknown = null;
    const client = {
      chat: {
        completions: {
          create: async (params: unknown) => {
            captured = params;
            return response as never;
          },
        },
      },
    } as never;
    const provider = new OpenAIProvider("sk-test", { model: "unknown-model", client });
    const result = await provider.complete({
      system: "نظام",
      messages: [{ role: "user", content: "قيّم" }],
      temperature: 0,
      maxOutputTokens: 1024,
    });
    expect(result.ok).toBe(true);
    const params = captured as { temperature?: number; max_tokens?: number };
    expect(params.temperature).toBe(0);
    expect(params.max_tokens).toBe(1024);
    const cost = estimateOpenaiCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 }, "unknown-model");
    expect(cost).toBeCloseTo(12.5, 5);
  });

  it("غياب usage → صفر رموز بلا كسر", async () => {
    const response = {
      choices: [{ message: { content: '{"scores":[]}' } }],
      usage: undefined,
    };
    const provider = new OpenAIProvider("sk-test", { client: fakeOpenaiClient(response) });
    const result = await provider.complete({ system: "نظام", messages: [{ role: "user", content: "قيّم" }] });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
  });
});
