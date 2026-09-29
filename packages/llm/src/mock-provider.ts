/**
 * مزود وهمي حتمي — المحول المرجعي لمنفذ LlmProvider.
 *
 * الوظيفة: تشغيل الوكلاء والاختبارات دون شبكة ودون تكلفة ودون عشوائية.
 * مصدرا الاستجابة بالترتيب:
 *   1. طابور مرتّب (enqueue) — يُستهلك نداء بعد نداء.
 *   2. دالة استجابة نقية (respond) — تُشتق الاستجابة من الطلب نفسه.
 * نضوب الطابور والدالة معاً = خطأ منظم (لا تخمين ولا قيم افتراضية خفية).
 */

import { err, ok, type Result } from "@agentbridge/shared";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider.js";
import { LlmErrors } from "./errors.js";

/** دالة نقية تحدد استجابة الهمي من محتوى الطلب */
export type MockResponder = (request: LlmRequest) => string;

export interface MockProviderOptions {
  /** استجابات مسبقة تُستهلك بالترتيب قبل اللجوء لدالة الاستجابة */
  readonly responses?: readonly string[];
  /** المصدر الاحتياطي عند نضوب الطابور */
  readonly respond?: MockResponder;
}

export class MockLlmProvider implements LlmProvider {
  readonly name = "mock";

  private readonly queue: string[];
  private readonly responder: MockResponder | null;

  constructor(options: MockProviderOptions = {}) {
    this.queue = [...(options.responses ?? [])];
    this.responder = options.respond ?? null;
  }

  /** يزرع استجابة في نهاية الطابور — لتركيب سيناريوهات متعددة الأدوار */
  enqueue(text: string): void {
    this.queue.push(text);
  }

  async complete(request: LlmRequest): Promise<Result<LlmResponse>> {
    const next = this.queue.shift();
    if (next !== undefined) {
      return ok({ text: next, provider: this.name });
    }
    if (this.responder !== null) {
      // الدالة النقية تضمن الحتمية: نفس الطلب = نفس الاستجابة
      return ok({ text: this.responder(request), provider: this.name });
    }
    return err(LlmErrors.emptyResponse(this.name));
  }
}
