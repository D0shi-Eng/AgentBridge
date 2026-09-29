/**
 * مزود Anthropic الحي — ينفذ LlmProvider فوق @anthropic-ai/sdk الرسمي.
 *
 * القواعد:
 * - تحويل LlmRequest→messages+system، استخلاص content[0].text وusage،
 *   لا يُقبل فراغ، أسعار ثابتة داخل الملف (حتمية بلا جلب شبكي).
 * - أخطاء شبكة/429/5xx→providerFailed (retryable)، فارغة→emptyResponse.
 * - التكلفة تُحسب من usage وتُمرر لدفتر الحارس عبر estimate (لا جلب).
 */

import Anthropic from "@anthropic-ai/sdk";
import { err, ok, type Result } from "@agentbridge/shared";
import { LlmErrors } from "./errors.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider.js";

/** جدول أسعار Anthropic بالدولار لكل مليون رمز — حتمي ثابت */
const ANTHROPIC_PRICES: Record<string, { input: number; output: number }> = {
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-sonnet-latest": { input: 3, output: 15 },
  "claude-3-haiku-20240307": { input: 0.25, output: 1.25 },
  "claude-3-opus-20240229": { input: 15, output: 75 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
};

/** السعر الافتراضي عند نموذج غير معروف */
const DEFAULT_PRICE = { input: 3, output: 15 };

/** يحسب التكلفة بالدولار من usage والنموذج */
export function estimateAnthropicCostUsd(
  usage: { inputTokens: number; outputTokens: number },
  model: string,
): number {
  const price = ANTHROPIC_PRICES[model] ?? DEFAULT_PRICE;
  return (usage.inputTokens / 1_000_000) * price.input + (usage.outputTokens / 1_000_000) * price.output;
}

export interface AnthropicProviderOptions {
  readonly model?: string;
  /** عميل محقون للاختبار — افتراضياً SDK الرسمي */
  readonly client?: Pick<Anthropic, "messages">;
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic";
  private readonly model: string;
  private readonly client: Anthropic;

  constructor(
    private readonly apiKey: string,
    options: AnthropicProviderOptions = {},
  ) {
    this.model = options.model ?? "claude-3-5-sonnet-20241022";
    // عميل محقون في الاختبارات يتجاوز SDK الحقيقي
    const injected = options.client as Anthropic | undefined;
    // وجهة صادرة مثبتة صراحة — متغيرات البيئة (ANTHROPIC_BASE_URL)
    // لا تحدد الوجهة حتى لو عبثت؛ اختراق البيئة لا يعيد توجيه المفاتيح
    this.client = injected ?? new Anthropic({ apiKey: this.apiKey, baseURL: "https://api.anthropic.com" });
  }

  async complete(request: LlmRequest): Promise<Result<LlmResponse>> {
    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: request.maxOutputTokens ?? 4096,
        system: request.system,
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      });

      const block = response.content[0];
      const text = block !== undefined && block.type === "text" ? block.text : "";
      if (text.trim().length === 0) {
        return err(LlmErrors.emptyResponse(this.name));
      }

      const usage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      };

      return ok({ text, provider: this.name, usage });
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error);
      // كل أخطاء الشبكة/429/5xx قابلة لإعادة المحاولة
      return err(LlmErrors.providerFailed(this.name, detail));
    }
  }
}
