/**
 * اختبارات مقياس الخطورة — جدول النقاط وخريطة المستويات.
 */

import { describe, expect, it } from "vitest";
import { countPiiHitsForEndpoint, scoreEndpointRisk } from "./risk-scorer.js";
import type { NormalizedEndpoint } from "@agentbridge/shared";

/** مصنع نقطة مطبعة للاختبار */
function endpoint(partial: Partial<NormalizedEndpoint>): NormalizedEndpoint {
  return {
    path: "/things",
    method: "get",
    operationId: "getThings",
    summary: "S",
    pathParams: [],
    requiresAuth: true,
    security: { alternatives: [{ schemes: [{ name: "bearerAuth", scopes: [] }] }], source: "global", unsupported: [] },
    fields: [],
    ...partial,
  };
}

describe("جدول النقاط", () => {
  it("قراءة مصادقة نظيفة = منخفضة", () => {
    expect(scoreEndpointRisk(endpoint({}), "read", 0)).toBe("low");
  });

  it("كتابة مصادقة نظيفة = متوسطة", () => {
    expect(scoreEndpointRisk(endpoint({ method: "post" }), "write", 0)).toBe("medium");
  });

  it("حذف مصادق = عالية (أساس 3 + كتابة غير محمية لا تنطبق)", () => {
    // delete أساسه 3 فقط → متوسطة؛ العالية تحتاج عاملاً إضافياً
    expect(scoreEndpointRisk(endpoint({ method: "delete" }), "write", 0)).toBe("medium");
    expect(scoreEndpointRisk(endpoint({ method: "delete" }, ), "write", 1)).toBe("high");
  });

  it("PII يرفع الخطورة درجتين", () => {
    expect(scoreEndpointRisk(endpoint({ method: "post" }), "write", 2)).toBe("high");
  });

  it("الكتابة غير المصادقة ترفع درجة إضافية", () => {
    expect(scoreEndpointRisk(endpoint({ method: "post", requiresAuth: false }), "write", 0)).toBe("high");
  });

  it("المنطقة الإدارية ترفع درجة إضافية", () => {
    expect(scoreEndpointRisk(endpoint({ method: "delete" }), "admin", 0)).toBe("high");
  });
});

describe("ربط الإصابات بالعملية", () => {
  it("يعد إصابات حقول هذه العملية فقط", () => {
    const ep = endpoint({
      fields: [
        { pointer: "/a/email", name: "email", location: "body", openApiType: "string", required: false },
        { pointer: "/a/phone", name: "phone", location: "body", openApiType: "string", required: false },
      ],
    });
    const hits = [
      { pointer: "/a/email", piiType: "email" },
      { pointer: "/a/phone", piiType: "phone" },
      { pointer: "/other/ssn", piiType: "financial" },
    ];
    expect(countPiiHitsForEndpoint(ep, hits)).toBe(2);
  });
});
