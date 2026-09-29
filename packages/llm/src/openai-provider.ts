/**
 * مزود OpenAI الحي — ينفذ LlmProvider فوق openai الرسمي.
 *
 * نفس العقد والقواعد كـ Anthropic: تحويل request→messages،
 * استخلاص choices[0].message.content وusage، أسعار ثابتة، أخطاء موحدة.
 */

import OpenAI from "openai";
import { err, ok, type Result } from "@agentbridge/shared";
import { LlmErrors } from "./errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider.js";

/** جدول أسعار OpenAI بالدولار لكل مليون رمز */
const OPENAI_PRICES: Record<string, { input: number; output: number }> = {
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4o-2024-08-06": { input: 2.5, output: 10 },
  "o1": { input: 15, output: 60 },
};

const DEFAULT_PRICE = { input: 2.5, output: 10 };

export function estimateOpenaiCostUsd(
  usage: { inputTokens: number; outputTokens: number },
  model: string,
): number {
  const price = OPENAI_PRICES[model] ?? DEFAULT_PRICE;
  return (usage.inputTokens / 1_000_000) * price.input + (usage.outputTokens / 1_000_000) * price.output;
}

export interface OpenaiProviderOptions {
  readonly model?: string;
  readonly client?: Pick<OpenAI, "chat">;
}

export class OpenAIProvider implements LlmProvider {
  readonly name = "openai";
  private readonly model: string;
  private readonly client: OpenAI;

  constructor(
    private readonly apiKey: string,
    options: OpenaiProviderOptions = {},
  ) {
    this.model = options.model ?? "gpt-4o";
    const injected = options.client as OpenAI | undefined;
    // وجهة صادرة مثبتة صراحة — OPENAI_BASE_URL من البيئة لا يُراعى
    this.client = injected ?? new OpenAI({ apiKey: this.apiKey, baseURL: "https://api.openai.com/v1" });
  }

  async complete(request: LlmRequest): Promise<Result<LlmResponse>> {
    try {
      const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
        { role: "system", content: request.system },
        ...request.messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
      ];

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxOutputTokens !== undefined ? { max_tokens: request.maxOutputTokens } : {}),
      });

      const text = response.choices[0]?.message?.content ?? "";
      if (text.trim().length === 0) {
        return err(LlmErrors.emptyResponse(this.name));
      }

      const usage = response.usage
        ? { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens }
        : { inputTokens: 0, outputTokens: 0 };

      return ok({ text, provider: this.name, usage });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      return err(LlmErrors.providerFailed(this.name, detail));
    }
  }
}
