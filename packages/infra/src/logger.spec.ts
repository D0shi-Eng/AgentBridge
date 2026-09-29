/**
 * اختبارات logger — تحوير الأسرار في النص الحر ومسارات pino.
 */
import { describe, expect, it } from "vitest";
import { REDACTED, REDACT_PATHS, buildLoggerOptions, redactText } from "./logger.js";

describe("buildLoggerOptions", () => {
  it("يمرر المستوى ويضمّن مسارات الحجوب الحساسة", () => {
    const options = buildLoggerOptions("debug");
    expect(options.level).toBe("debug");
    expect(options.redact.paths).toContain("req.headers.authorization");
    expect(options.redact.censor).toBe(REDACTED);
  });
});

describe("redactText", () => {
  it("يحجب المفاتيح الشبيهة بأسرار المزودين", () => {
    expect(redactText("المفتاح sk-abcdefgh123456789 مضمّن")).toBe(`المفتاح ${REDACTED} مضمّن`);
  });

  it("يحجب تعيينات password/token/apiKey بصيغتي : و =", () => {
    expect(redactText("password: hunter2")).toBe(`password: ${REDACTED}`);
    expect(redactText("api_key=abc123")).toBe(`api_key=${REDACTED}`);
    expect(redactText('{"token": "xyz"}')).toContain(REDACTED);
  });

  it("لا يمس النص النظيف إطلاقاً", () => {
    const clean = "اجتاز الخادم 10 من 10 فحوص بدرجة نظافة 100";
    expect(redactText(clean)).toBe(clean);
  });

  it("قائمة المسارات تشمل الكوكيز وكل أسماء الأسرار الشائعة", () => {
    for (const path of ["req.headers.cookie", "*.password", "*.token", "*.secret", "*.apiKey"]) {
      expect(REDACT_PATHS).toContain(path);
    }
  });
});
