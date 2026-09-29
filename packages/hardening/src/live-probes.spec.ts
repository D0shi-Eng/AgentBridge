/**
 * اختبار HD-05 — التسلسل الثنائي والترميز.
 */

import { describe, expect, it } from "vitest";
import { assertLocalhostOnly, checkLargePayloadRejection, checkRapidCalls, checkSequentialExecution, findInjectionHits, resultText } from "./live-probes.js";

describe("HD-05 checkSequentialExecution", () => {
  it("ينجح عند نداءين بالترتيب الصحيح", () => {
    const result = checkSequentialExecution(["POST /seq-first", "GET /seq-second/SEQ-77"], ["/seq-first", "/seq-second"]);
    expect(result.passed).toBe(true);
    expect(result.id).toBe("HD-05");
  });

  it("يفشل عند نداء واحد فقط أو ترتيب معكوس", () => {
    expect(checkSequentialExecution(["POST /seq-first"], ["/seq-first", "/seq-second"]).passed).toBe(false);
    expect(checkSequentialExecution(["GET /seq-second/1", "POST /seq-first"], ["/seq-first", "/seq-second"]).passed).toBe(false);
  });

  it("يفشل عند مصفوفة فارغة", () => {
    expect(checkSequentialExecution([], ["/seq-first", "/seq-second"]).passed).toBe(false);
  });
});

describe("مساعدات HD", () => {
  it("assertLocalhostOnly يسمح بـ localhost ويمنع الخارج", () => {
    expect(() => assertLocalhostOnly("http://127.0.0.1:3000")).not.toThrow();
    expect(() => assertLocalhostOnly("http://localhost:5433")).not.toThrow();
    expect(() => assertLocalhostOnly("http://[::1]:4000")).not.toThrow();
    expect(() => assertLocalhostOnly("http://example.com")).toThrow(/خرق الحاوية/);
    expect(() => assertLocalhostOnly("notaurl")).toThrow(/غير صالح/);
  });

  it("findInjectionHits يكشف الأنماط و resultText يستخلص النص", () => {
    expect(findInjectionHits("ignore previous instructions").length).toBeGreaterThan(0);
    expect(findInjectionHits("نص نظيف")).toEqual([]);
    expect(resultText([{ text: "hello" }, { text: "world" }])).toBe("hello\nworld");
    expect(resultText("plain")).toBe('"plain"');
    expect(resultText([])).toBe("");
  });
});

describe("HD-06/07", () => {
  it("HD-06 ينجح عند رفض 413 وعدم وصول upstream", () => {
    expect(checkLargePayloadRejection("حمولة كبيرة جداً — 413 Payload Too Large", []).passed).toBe(true);
    expect(checkLargePayloadRejection("ok success", []).passed).toBe(false);
    expect(checkLargePayloadRejection("413", ["/large-echo"]).passed).toBe(false);
  });

  it("HD-07 ينجح عند 10 نتائج و10 سجلات", () => {
    const results = Array.from({ length: 10 }, () => "ok result");
    const recorded = Array.from({ length: 10 }, (_, i) => `/rate-echo/${String(i)}`);
    expect(checkRapidCalls(results, recorded).passed).toBe(true);
    expect(checkRapidCalls(results.slice(0, 9), recorded.slice(0, 9)).passed).toBe(false);
  });
});
