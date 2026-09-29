/**
 * اختبارات نموذج التحقق العام — بوابة شكل الرد قبل عرضه للزائر.
 */
import { describe, expect, it } from "vitest";
import { parsePublicVerification, verificationFacts, type PublicVerification } from "./verify-model.js";

const VALID: PublicVerification = {
  verificationId: "AB-0123456789abcdef",
  artifactsHash: "a".repeat(64),
  finalScore: 92,
  granted: true,
  issuedAt: "2026-08-25T10:00:00.000Z",
  revoked: false,
};

describe("parsePublicVerification", () => {
  it("رد سليم يعود كما هو", () => {
    expect(parsePublicVerification({ ...VALID })).toEqual(VALID);
  });

  it.each([
    ["لا كائن", null],
    ["معرف بصيغة غلط", { ...VALID, verificationId: "XX-1" }],
    ["بصمة قصيرة", { ...VALID, artifactsHash: "abc" }],
    ["درجة فوق المدى", { ...VALID, finalScore: 101 }],
    ["درجة عشرية", { ...VALID, finalScore: 92.5 }],
    ["قرار غير منطقي", { ...VALID, granted: "yes" }],
    ["زمن غير قابل للتحليل", { ...VALID, issuedAt: "yesterday" }],
    ["حقل ناقص", { verificationId: VALID.verificationId }],
  ])("يرفض: %s", (_name, bad) => {
    expect(parsePublicVerification(bad)).toBeNull();
  });
});

describe("verificationFacts", () => {
  it("أربعة صفوف والبصمة مقطوعة والتقنية أحادية الاتجاه", () => {
    const rows = verificationFacts(VALID, "ar");
    expect(rows).toHaveLength(4);
    expect(rows[2]?.value).toBe(`${"a".repeat(32)}…`);
    expect(rows.filter((row) => row.mono === true)).toHaveLength(2);
    expect(rows.some((row) => row.value.includes("92"))).toBe(true);
  });

  it("تسميات الصفوف تتبع اللغة المطلوبة", () => {
    expect(verificationFacts(VALID, "en")[0]?.key).toBe("Verification ID");
    expect(verificationFacts(VALID, "ar")[0]?.key).toBe("معرّف التحقق");
  });
});
