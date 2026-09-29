/**
 * اختبارات ماسح PII — القاموس والكشف الاحتياطي والحتمية.
 */

import { describe, expect, it } from "vitest";
import { scanFieldsForPii } from "./pii-scanner.js";
import type { FieldDescriptor } from "@agentbridge/shared";

/** مصنع حقل للاختبار */
function field(name: string, openApiType: string = "string"): FieldDescriptor {
  return { pointer: `/test/${name}`, name, location: "body", openApiType, required: false };
}

describe("قاموس أنماط PII", () => {
  it("يصنف البريد والهاتف والاسم", () => {
    const hits = scanFieldsForPii([field("email"), field("ownerPhone"), field("firstName")]);
    const types = hits.map((h) => h.piiType).sort();
    expect(types).toEqual(["email", "name", "phone"]);
  });

  it("يصنف الصحي والمالي", () => {
    const hits = scanFieldsForPii([field("diagnosisText"), field("creditCardNumber"), field("iban")]);
    const types = hits.map((h) => h.piiType).sort();
    expect(types).toEqual(["financial", "financial", "health"]);
  });

  it("يلتقط العنوان ومعرّفات الهوية الوطنية", () => {
    const hits = scanFieldsForPii([field("homeAddress"), field("nationalId")]);
    const types = hits.map((h) => h.piiType).sort();
    expect(types).toEqual(["address", "financial"]);
  });
});

describe("الكشف الاحتياطي والسلامة", () => {
  it("يمرر الحقول غير الشخصية دون إصابات", () => {
    const hits = scanFieldsForPii([field("orderId"), field("totalAmount", "number"), field("createdAt")]);
    expect(hits).toEqual([]);
  });

  it("يحافظ على مؤشر المصدر في كل إصابة", () => {
    const hits = scanFieldsForPii([{ ...field("patientEmail"), pointer: "/paths/~1pets/post/requestBody" }]);
    expect(hits[0]?.pointer).toBe("/paths/~1pets/post/requestBody");
    expect(hits[0]?.piiType).toBe("email");
  });

  it("حتمي: نفس المدخل يعيد نفس الخرج بالترتيب نفسه", () => {
    const input = [field("email"), field("phone"), field("email")];
    expect(scanFieldsForPii(input)).toEqual(scanFieldsForPii(input));
  });
});
