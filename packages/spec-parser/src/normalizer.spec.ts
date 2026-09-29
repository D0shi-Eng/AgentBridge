/**
 * اختبارات المطبّع — التوحيد: المعرفات المولدة، الملخصات، المصادقة، القوالب.
 */

import { describe, expect, it } from "vitest";
import { buildNormalizedSpec } from "./normalizer.js";
import type { ValidatedDocument, ValidatedOperation } from "./validator.js";

/** مصنع عمليات للاختبار بقيم افتراضية قابلة للتجاوز */
function op(partial: Partial<ValidatedOperation> = {}): ValidatedOperation {
  return {
    pathKey: "/things",
    method: "get",
    responses: {},
    ...partial,
  };
}

/** مستند أدنى صالح للتغذية للمطبّع — سجل schemes فارغ افتراضياً */
function doc(operations: ValidatedOperation[], globalSecurity?: readonly unknown[], schemes: ValidatedDocument["securitySchemes"] = new Map()): ValidatedDocument {
  return { openapiVersion: "3.0.3", title: "T", globalSecurity, securitySchemes: schemes, pathItems: [{ path: operations[0]?.pathKey ?? "/x", operations }] };
}

describe("توليد operationId عند غيابه", () => {
  it("يبني معرفاً من الفعل والمسار المنظف", () => {
    const spec = buildNormalizedSpec(doc([op({ pathKey: "/billing/invoices/{id}/lines", method: "post" })]));
    expect(spec.endpoints[0]?.operationId).toBe("post_billing_invoices_id_lines");
  });

  it("يفضل المعرف المصرح به إن وُجد", () => {
    const spec = buildNormalizedSpec(doc([op({ operationId: "declared" })]));
    expect(spec.endpoints[0]?.operationId).toBe("declared");
  });
});

describe("الملخص الحتمي", () => {
  it("يفضل summary ثم description ثم القالب", () => {
    const withSummary = buildNormalizedSpec(doc([op({ summary: "S" })])).endpoints[0];
    const withDescription = buildNormalizedSpec(doc([op({ description: "D" })])).endpoints[0];
    const withNeither = buildNormalizedSpec(doc([op({ pathKey: "/a/b", method: "delete" })])).endpoints[0];
    expect(withSummary?.summary).toBe("S");
    expect(withDescription?.summary).toBe("D");
    expect(withNeither?.summary).toBe("DELETE /a/b");
  });

  it("يرفض ملخضاً فارغاً فراغياً وينزل للوصف", () => {
    const spec = buildNormalizedSpec(doc([op({ summary: "   ", description: "الوصف" })]));
    expect(spec.endpoints[0]?.summary).toBe("الوصف");
  });
});

describe("هرمية قرار المصادقة", () => {
  it("عملية بلا security ترث العامة الجذرية", () => {
    const spec = buildNormalizedSpec(doc([op({})], [{ oauth: [] }]));
    expect(spec.endpoints[0]?.requiresAuth).toBe(true);
  });

  it("مصفوفة فارغة تعلن إلغاء المصادقة مقصوداً", () => {
    const spec = buildNormalizedSpec(doc([op({ security: [] })], [{ oauth: [] }]));
    expect(spec.endpoints[0]?.requiresAuth).toBe(false);
  });
});

describe("معاملات المسار", () => {
  it("يدمج المصرح مع قوالب المسار بلا تكرار", () => {
    const spec = buildNormalizedSpec(
      doc([
        op({
          pathKey: "/users/{userId}/posts/{postId}",
          parameters: [{ name: "userId", in: "path", schema: {} }],
        }),
      ]),
    );
    expect(spec.endpoints[0]?.pathParams).toEqual(["userId", "postId"]);
  });

  it("يحصي النقاط ويطابق العدد", () => {
    const spec = buildNormalizedSpec(doc([op(), op()]));
    expect(spec.endpointCount).toBe(2);
    expect(spec.endpoints).toHaveLength(2);
  });
});
