/**
 * سياسة إعادة المحاولة — جدول قرارات الفشل (وثيقة 09 §سياسة الإعادة).
 *
 * | النوع                        | السلوك |
 * | خطأ شبكة LLM / timeout       | retry أسي 3 محاولات + jitter |
 * | خرج مخالف للمخطط             | تحويل مباشر لوكيل الإصلاح (لا retry أعمى) |
 * | نتيجة حرجة في التحصين        | فشل فوري fatal — لا إصلاح يتجاوز السقف |
 * | استنفاد سقف الإصلاح          | needs_human وإشعار |
 *
 * المهلة قابلة للحقن حتى تبقى الاختبارات حتمية وسريعة.
 */

import type { AppError } from "@agentbridge/shared";

/** التأخيرات الأُسية بالمللي ثانية — 1s ثم 4s ثم 16s */
export const RETRY_DELAYS_MS: readonly number[] = [1000, 4000, 16000];

/** سقف دورات الإصلاح لكل artifact — مثبت في وثيقتي 04 و09 */
export const MAX_REPAIR_CYCLES = 3;

/** رموز الأخطاء التي تستحق إعادة محاولة زمنية (شبكة/انشغال) لا أكثر */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  "LLM_PROVIDER_FAILED",
  "LLM_EMPTY_RESPONSE",
]);

export type FailureDecision = { readonly action: "retry"; readonly delayMs: number } | { readonly action: "stop" };

/** هل الخطأ من العائلة العابرة (شبكة/انشغال) التي تستحق إعادة زمنية؟ */
export function isTransientError(error: AppError): boolean {
  return TRANSIENT_CODES.has(error.code);
}

/**
 * يقرر مصير خطأ failed(retryable):
 * المحاولة رقم attempt تبدأ من 1؛ تجاوز طول الجدول = توقف نهائي.
 * jitter بسيط حتمي مشتق من رقم المحاولة (لا عشوائية في القرار).
 */
export function decideRetry(error: AppError, attempt: number): FailureDecision {
  if (!TRANSIENT_CODES.has(error.code)) return { action: "stop" };
  const index = attempt - 1;
  if (index >= RETRY_DELAYS_MS.length) return { action: "stop" };
  const base = RETRY_DELAYS_MS[index] ?? 0;
  // jitter حتمي ±10% مشتق من رقم المحاولة — يكسر التزامن دون عشوائية
  const jitter = base === 0 ? 0 : Math.floor((attempt % 2 === 0 ? -1 : 1) * base * 0.1);
  return { action: "retry", delayMs: base + jitter };
}

/** مهلة الانتظار القابلة للحقن — الافتراضية setTimeout الحقيقية */
export type SleepFn = (ms: number) => Promise<void>;

export const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
