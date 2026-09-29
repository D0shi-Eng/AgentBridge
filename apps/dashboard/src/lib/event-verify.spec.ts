/**
 * اختبارات عرض الأحداث المترجم وحالات التحقق العامة الجديدة.
 *
 * كود معروف يترجم باللغتين بمعاملاته؛ كود غير معروف يسقط في
 * fallback آمن يذكر الكود؛ حدث تاريخي بلا كود يظهر ملخصه في العربية
 * ورسالة محايدة في الإنجليزية — لا نص عربي يتسرب إلى واجهة EN أبداً.
 * وتغطية إضافية: parsePublicVerification يقبض revoked/expired/bad-signature
 * ويلتزم شكل {present:false} للشهادات غير الموقعة.
 */

import { describe, expect, it } from "vitest";
import { eventDisplay, summarize } from "./run-model.js";
import { parsePublicVerification } from "./verify-model.js";
import type { PipelineEvent } from "@agentbridge/shared";

describe("eventDisplay", () => {
  it("كود معروف يترجم بالعربية والإنجليزية مع استيفاء المعاملات", () => {
    const row = { code: "spec.received", params: { bytes: 512 }, summary: "نص عربي خام" };
    expect(eventDisplay(row, "ar")).toBe("استُقبلت المواصفة (512 بايت)");
    expect(eventDisplay(row, "en")).toBe("Specification received (512 bytes)");
  });

  it("كود غير معروف يعرض fallback آمناً يذكر الكود — لا نص خام إطلاقاً", () => {
    const row = { code: "totally.unknown_code", summary: "نص عربي خام" };
    expect(eventDisplay(row, "en")).toBe("Event with a code unknown to this UI (totally.unknown_code)");
    expect(eventDisplay(row, "ar")).toContain("totally.unknown_code");
  });

  it("حدث تاريخي بلا كود: العربية تعرض ملخصه والإنجليزية رسالة محايدة", () => {
    const row = { code: undefined, params: undefined, summary: "استُقبلت المواصفة (100 بايت)" };
    expect(eventDisplay(row, "ar")).toBe("استُقبلت المواصفة (100 بايت)");
    expect(eventDisplay(row, "en")).not.toContain("استُقبلت");
  });

  it("summarize يحمل code وparams من الحدث إلى الصف", () => {
    const event = {
      runId: "r1", tenantId: "t1", stage: "harden" as const, at: new Date().toISOString(),
      summary: "اجتاز 13/13", code: "harden.passed", params: { passed: 13, total: 13, cleanliness: 100 },
    } satisfies PipelineEvent;
    const rows = summarize([event]).rows;
    expect(rows[0]?.code).toBe("harden.passed");
    expect(rows[0]?.params?.cleanliness).toBe(100);
  });
});

describe("المسار B: parsePublicVerification", () => {
  const base = {
    verificationId: "AB-0123456789abcdef",
    artifactsHash: "a".repeat(64),
    finalScore: 92,
    granted: true,
    issuedAt: "2026-08-25T10:00:00.000Z",
  };

  it("رد بلا revoked (عقد قديم) يُرفض كلياً — لا عرض بقرار ناقص", () => {
    expect(parsePublicVerification({ ...base })).toBeNull();
  });

  it("شهادة ملغاة تُقبل مع العلم الصريح", () => {
    const parsed = parsePublicVerification({
      ...base,
      granted: true,
      revoked: true,
      signature: { present: true, valid: false, reason: "revoked" },
    });
    expect(parsed?.revoked).toBe(true);
    expect(parsed?.signature?.reason).toBe("revoked");
  });

  it("سبب توقيع غير معروف يُرفض — لا عرض لحالة مختلقة", () => {
    expect(parsePublicVerification({
      ...base,
      revoked: false,
      signature: { present: true, valid: false, reason: "quantum-decay" },
    })).toBeNull();
  });

  it("شهادة غير موقعة: signature.present=false بلا valid", () => {
    const parsed = parsePublicVerification({ ...base, revoked: false, signature: { present: false } });
    expect(parsed?.signature?.present).toBe(false);
    expect(parsed?.signature?.valid).toBeUndefined();
  });
});
