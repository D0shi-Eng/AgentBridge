/**
 * مزود التضمينات — ينفذ EmbeddingsProvider فوق openai الرسمي.
 *
 * ماهيته: تحويل نص إلى متجه 1536 بُعداً عبر text-embedding-3-small — L3 الحية.
 * وظيفته: يغذي PgVectorStore بلا تضمينات مزيفة؛ كل تحويل عبر الشبكة حصراً.
 * كيف: يستدعي openai.embeddings.create؛ فارغ→emptyResponse، شبكة/429/5xx→providerFailed
 * retryable؛ سعر ثابت لكل 1M رمز (0.02$) حتمي بلا جلب شبكي.
 */

import OpenAI from "openai";
import { err, ok, type Result } from "@agentbridge/shared";
import { LlmErrors } from "./errors.js";

/** سعر text-embedding-3-small بالدولار لكل مليون رمز */
const EMBEDDING_PRICE_PER_MILLION = 0.02;

export function estimateEmbeddingCostUsd(tokens: number): number {
  return (tokens / 1_000_000) * EMBEDDING_PRICE_PER_MILLION;
}

export interface EmbeddingsProvider {
  readonly name: string;
  embed(text: string): Promise<Result<{ embedding: number[]; tokensUsed: number }>>;
}

export interface OpenAiEmbeddingsOptions {
  readonly model?: string;
  readonly client?: Pick<OpenAI, "embeddings">;
}

export class OpenAiEmbeddingsProvider implements EmbeddingsProvider {
  readonly name = "openai-embeddings";
  private readonly model: string;
  private readonly client: OpenAI;

  constructor(
    private readonly apiKey: string,
    options: OpenAiEmbeddingsOptions = {},
  ) {
    this.model = options.model ?? "text-embedding-3-small";
    const injected = options.client as OpenAI | undefined;
    // وجهة صادرة مثبتة صراحة كما في مزود الإكمال
    this.client = injected ?? new OpenAI({ apiKey: this.apiKey, baseURL: "https://api.openai.com/v1" });
  }

  async embed(text: string): Promise<Result<{ embedding: number[]; tokensUsed: number }>> {
    if (text.trim().length === 0) return err(LlmErrors.emptyResponse(this.name));
    try {
      const response = await this.client.embeddings.create({ model: this.model, input: text });
      const data = response.data[0];
      const embedding = data?.embedding;
      if (embedding === undefined || embedding.length === 0) return err(LlmErrors.emptyResponse(this.name));
      const tokensUsed = response.usage?.prompt_tokens ?? 0;
      return ok({ embedding: [...embedding], tokensUsed });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return err(LlmErrors.providerFailed(this.name, detail));
    }
  }
}
