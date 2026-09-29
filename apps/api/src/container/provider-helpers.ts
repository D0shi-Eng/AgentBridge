/**
 * مساعدو المزودين للحاوية — مصانع المزودين ومقدّر التكلفة والتأخير المزيف.
 *
 * ماهيتها: تجميع كل منطق اختيار المزود وتقدير التكلفة والتأخير الصناعي
 * بعيداً عن تجميع التبعيات نفسه — فلا يتجاوز container.ts حد الـ200 سطر.
 * وظيفتها: اختيار Anthropic/OpenAI/mock حسب الإعداد، حساب تكلفة الاستجابة
 * من حقول usage/provider، وتغليف أي مزود بتأخير مصطنع للاختبارات الحية.
 * كيف: دوال نقية خالصة (لا حالة خارجية) تُستدعى من buildContainer عند الحاجة.
 */

import { AnthropicProvider, estimateAnthropicCostUsd, estimateOpenaiCostUsd, OpenAIProvider, type LlmProvider } from "@agentbridge/llm";
import type { AppConfig } from "@agentbridge/infra";
import { createStandardProviderFactory } from "../run-service/provider-factory.js";

/**
 * مصنع المزودين الحقيقي — يختار Anthropic/OpenAI/mock حسب config.
 */
export function createProviderFactoryForConfig(config: AppConfig): () => LlmProvider {
  return () => {
    if (config.llmProvider === "anthropic") return new AnthropicProvider(config.anthropicApiKey);
    if (config.llmProvider === "openai") return new OpenAIProvider(config.openaiApiKey);
    return createStandardProviderFactory()();
  };
}

/**
 * مقدّر تكلفة موحد — يختار جدول السعر حسب حقل provider في الاستجابة.
 */
export function estimateCostFromResponse(response: { provider: string; usage?: { inputTokens: number; outputTokens: number } }): number {
  if (response.usage === undefined) return 0;
  if (response.provider === "anthropic") return estimateAnthropicCostUsd(response.usage, "claude-3-5-sonnet-20241022");
  if (response.provider === "openai") return estimateOpenaiCostUsd(response.usage, "gpt-4o");
  return 0;
}

/**
 * يلف مصنع مزود بتأخير مصطنع — لنافذة بث حية قابلة للاختبار.
 */
export function wrapDelayed(factory: () => LlmProvider, delayMs: number): () => LlmProvider {
  return () => {
    const inner = factory();
    return {
      get name(): string {
        return inner.name;
      },
      async complete(request) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        return inner.complete(request);
      },
    };
  };
}
