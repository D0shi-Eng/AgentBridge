/**
 * اختبارات سياسة إعادة المحاولة — جدول قرارات 09 حتمي بالكامل.
 */

import { describe, expect, it } from "vitest";
import { AppError } from "@agentbridge/shared";
import { decideRetry, isTransientError, MAX_REPAIR_CYCLES, RETRY_DELAYS_MS } from "./retry-policy.js";

const transient = new AppError("LLM_PROVIDER_FAILED", "شبكة", true, "warning");
const schemaInvalid = new AppError("LLM_OUTPUT_INVALID", "خرج مخالف", true, "warning");
const critical = new AppError("SECURITY_CRITICAL", "حرج", false, "critical");

/** قيم الجدول كثوابت محلية — تفادي الوصول المفهرس غير المؤمن نوعياً */
const D1 = RETRY_DELAYS_MS[0] ?? 1000;
const D2 = RETRY_DELAYS_MS[1] ?? 4000;
const D3 = RETRY_DELAYS_MS[2] ?? 16000;

describe("decideRetry", () => {
  it("العيب العابر يعاد بتأخيرات أُسية مع jitter حتمي ±10%", () => {
    expect(decideRetry(transient, 1)).toEqual({ action: "retry", delayMs: D1 + 100 });
    expect(decideRetry(transient, 2)).toEqual({ action: "retry", delayMs: D2 - 400 });
    expect(decideRetry(transient, 3)).toEqual({ action: "retry", delayMs: D3 + 1600 });
  });

  it("بعد استنفاد الجدول يتوقف نهائياً", () => {
    expect(decideRetry(transient, 4).action).toBe("stop");
    expect(decideRetry(transient, 9).action).toBe("stop");
  });

  it("خرج المخطط المخالف لا يُعاد أعمى ولو كان retryable — يذهب للإصلاح", () => {
    expect(decideRetry(schemaInvalid, 1).action).toBe("stop");
  });

  it("الحرج غير قابل للإعادة إطلاقاً", () => {
    expect(decideRetry(critical, 1).action).toBe("stop");
  });

  it("القرار حتمي: نفس المدخلات = نفس التأخير (jitter مشتق لا عشوائي)", () => {
    const a = decideRetry(transient, 2);
    const b = decideRetry(transient, 2);
    expect(a).toEqual(b);
  });
});

describe("isTransientError", () => {
  it("يميز عائلة الشبكة/المزود عن غيرها", () => {
    expect(isTransientError(transient)).toBe(true);
    expect(isTransientError(new AppError("LLM_EMPTY_RESPONSE", "فارغ", true))).toBe(true);
    expect(isTransientError(schemaInvalid)).toBe(false);
  });
});

describe("الثوابت الموثقة", () => {
  it("سقف الإصلاح ثلاث دورات والجدول ثلاث محاولات — كما في الوثائق", () => {
    expect(MAX_REPAIR_CYCLES).toBe(3);
    expect(RETRY_DELAYS_MS).toEqual([1000, 4000, 16000]);
  });
});
