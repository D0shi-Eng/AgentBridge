/**
 * المنفذ العام لحزمة llm — تجريد المزودين وبوابة تحقق المخرجات.
 *
 * تُصدَّر أربع قطع فقط:
 *   1. عقد المنفذ (LlmProvider وأنواعه) الذي تنفذه كل محولات المستقبل.
 *   2. المحول الحتمي MockLlmProvider للتطوير والاختبار.
 *   3. بوابة parseStructuredOutput التي لا يعبرها نص نموذج إلا مطابقاً.
 *   4. المجيب الحتمي الموحد للأدوار الأربعة (مشترك بين api وcli — ADR-14).
 */

export type { LlmMessage, LlmProvider, LlmRequest, LlmResponse, LlmUsage } from "./provider.js";
export { LlmErrors } from "./errors.js";
export { AnthropicProvider, estimateAnthropicCostUsd } from "./anthropic-provider.js";
export { OpenAIProvider, estimateOpenaiCostUsd } from "./openai-provider.js";
export { MockLlmProvider, type MockProviderOptions, type MockResponder } from "./mock-provider.js";
export { extractJsonBlock, parseStructuredOutput } from "./structured-output.js";
export {
  createDeterministicResponder,
  extractBlock,
  toSnakeCase,
  type DeterministicResponderOptions,
} from "./deterministic-responder.js";
export {
  createInMemoryCostLedger,
  withBudgetGuard,
  type BudgetDecision,
  type BudgetGuardOptions,
  type CostLedger,
} from "./budget-guard.js";
export {
  budgetExceeded,
  createInMemoryReservationLedger,
  withBudgetReservation,
  type BudgetReservation,
  type BudgetReservationGuardOptions,
  type ReservationLedger,
} from "./budget-reservation.js";
export {
  estimateEmbeddingCostUsd,
  OpenAiEmbeddingsProvider,
  type EmbeddingsProvider,
  type OpenAiEmbeddingsOptions,
} from "./embeddings-provider.js";
