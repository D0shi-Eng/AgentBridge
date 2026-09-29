/**
 * مصنع المزود الحتمي القياسي — مجيب deterministic لأنماط حقن hardening.
 *
 * ماهيته: دالة نقية تنشئ MockLlmProvider بمجيب يطبّع نفس الاستجابات عبر
 * كل الواجهات (CLI/API) — ADR-14: المصدر الوحيد للمجيب هو llm هنا.
 * وظيفته: يزود الحاوية والاختبارات بمزود حتمي صفري التكلفة بلا شبكة.
 * كيف: يمرر INJECTION_PATTERNS الرسمية لإنشاء responder ثم يلفه في Mock.
 */

import { INJECTION_PATTERNS } from "@agentbridge/hardening";
import { createDeterministicResponder, MockLlmProvider, type LlmProvider } from "@agentbridge/llm";

/**
 * ينشئ مصنع مزود حتمي قياسي — نفس السلوك في كل التشغيلات.
 */
export function createStandardProviderFactory(): () => LlmProvider {
  return () =>
    new MockLlmProvider({
      respond: createDeterministicResponder({ injectionPatterns: INJECTION_PATTERNS }),
    });
}
