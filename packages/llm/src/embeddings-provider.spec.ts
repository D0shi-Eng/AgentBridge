/**
 * اختبارات مزود التضمينات — بعميل مزيف (لا شبكة).
 */

import { describe, it, expect, vi } from "vitest";
import { OpenAiEmbeddingsProvider } from "./embeddings-provider.js";

function fakeClient(impl: (args: unknown) => Promise<unknown>): unknown {
  return { embeddings: { create: vi.fn(impl) } } as unknown;
}

describe("OpenAiEmbeddingsProvider", () => {
  it("نجاح: يعيد متجه 1536 ورموز الاستعمال", async () => {
    const vec = Array.from({ length: 1536 }, () => 0.1);
    const client = fakeClient(async () => ({ data: [{ embedding: vec }], usage: { prompt_tokens: 5 } }));
    const provider = new OpenAiEmbeddingsProvider("sk-fake", { client: client as never });
    const result = await provider.embed("نص تجريبي");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.embedding.length).toBe(1536);
      expect(result.value.tokensUsed).toBe(5);
    }
  });

  it("نص فارغ → emptyResponse غير retryable صامت؟ (LLM_EMPTY_RESPONSE)", async () => {
    const client = fakeClient(async () => ({ data: [{ embedding: [] }] }));
    const provider = new OpenAiEmbeddingsProvider("sk-fake", { client: client as never });
    const result = await provider.embed("   ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_EMPTY_RESPONSE");
  });

  it("تضمين فارغ من المزود → emptyResponse", async () => {
    const client = fakeClient(async () => ({ data: [{ embedding: [] }] }));
    const provider = new OpenAiEmbeddingsProvider("sk-fake", { client: client as never });
    const result = await provider.embed("نص");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("LLM_EMPTY_RESPONSE");
  });

  it("خطأ شبكة → providerFailed retryable", async () => {
    const client = fakeClient(async () => { throw new Error("network down"); });
    const provider = new OpenAiEmbeddingsProvider("sk-fake", { client: client as never });
    const result = await provider.embed("نص");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_PROVIDER_FAILED");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("تقدير التكلفة حتمي: 1M رمز = 0.02$", async () => {
    const { estimateEmbeddingCostUsd } = await import("./embeddings-provider.js");
    expect(estimateEmbeddingCostUsd(1_000_000)).toBeCloseTo(0.02);
    expect(estimateEmbeddingCostUsd(500_000)).toBeCloseTo(0.01);
  });
});
