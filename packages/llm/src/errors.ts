/**
 * مصنع أخطاء حزمة llm — امتداد لشجرة الأخطاء الموحدة في shared.
 *
 * كل أخطاء الشبكة/المزود قابلة لإعادة المحاولة (retryable) لأنها عابرة،
 * بينما خرج مخالف للمخطط يُعالج عبر Errors.llmOutputInvalid في shared.
 */

import { AppError } from "@agentbridge/shared";

export const LlmErrors = {
  /** فشل نداء المزود نفسه (شبكة، حد معدل، انقطاع) — يستحق إعادة محاولة */
  providerFailed: (provider: string, detail: string) =>
    new AppError(
      "LLM_PROVIDER_FAILED",
      `فشل مزود النموذج "${provider}": ${detail}`,
      true,
      "warning",
    ),

  /** المزود أعاد نصاً فارغاً — لا شيء يمكن التحقق منه */
  emptyResponse: (provider: string) =>
    new AppError(
      "LLM_EMPTY_RESPONSE",
      `أعاد مزود النموذج "${provider}" استجابة فارغة`,
      true,
      "warning",
    ),
} as const;
