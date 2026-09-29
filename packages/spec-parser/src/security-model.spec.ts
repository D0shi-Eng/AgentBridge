/**
 * اختبارات النموذج الأمني.
 *
 * تثبت الملزمة: لا اختزال المخططات إلى boolean — تُحفظ دلالات
 * OR/AND/scopes والoverride والفرق بين [] والغياب، وكل مرجع غير
 * مدعوم يدخل unsupported بسببه صريحاً بدل حماية ناقصة بصمت.
 */

import { describe, expect, it } from "vitest";
import { buildSecurityModel, extractSecuritySchemes, securityRequiresAuth } from "./security-model.js";

/** يبني سجل schemes من كائن حرفي للاختبار */
function schemesOf(defs: Record<string, unknown>) {
  return extractSecuritySchemes({ components: { securitySchemes: defs } });
}

/** خيارات سريعة: متطلبات العملية والجذر وسجل المخططات */
const base = { schemes: schemesOf({}) };

describe("أولوية القرار: العملية ثم الجذر ثم لا شيء", () => {
  it("تعليمة العملية تتقدم على الجذر (override صريح)", () => {
    const model = buildSecurityModel({
      operationSecurity: [],
      globalSecurity: [{ bearerAuth: [] }],
      schemes: base.schemes,
    });
    expect(model.source).toBe("operation");
    expect(model.alternatives).toEqual([]);
    expect(securityRequiresAuth(model)).toBe(false);
  });

  it("غياب العملية يورث الجذر", () => {
    const model = buildSecurityModel({ globalSecurity: [{ bearerAuth: [] }], schemes: base.schemes });
    expect(model.source).toBe("global");
    expect(model.alternatives).toHaveLength(1);
    expect(securityRequiresAuth(model)).toBe(true);
  });

  it("غياب الاثنين = لا مصادقة أصلاً وليس عاماً إعلاناً", () => {
    const model = buildSecurityModel(base);
    expect(model.source).toBe("none");
    expect(model.alternatives).toEqual([]);
  });

  it("security: [] على الجذر = إعلان عام صريح لا غياب", () => {
    const model = buildSecurityModel({ globalSecurity: [], schemes: base.schemes });
    expect(model.source).toBe("global");
    expect(model.alternatives).toEqual([]);
  });
});

describe("دلالات OR وAND وscopes", () => {
  const schemes = schemesOf({
    bearerAuth: { type: "http", scheme: "bearer" },
    apiKeyHeader: { type: "apiKey", in: "header", name: "X-Key" },
    oauth: { type: "oauth2", flows: { clientCredentials: {} } },
  });

  it("OR بين بدائل: أي متطلب يكفي", () => {
    const model = buildSecurityModel({
      operationSecurity: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
      schemes,
    });
    expect(model.alternatives).toHaveLength(2);
    expect(model.alternatives[0]?.schemes[0]?.name).toBe("bearerAuth");
    expect(model.alternatives[1]?.schemes[0]?.name).toBe("apiKeyHeader");
  });

  it("AND داخل البديل الواحد: schemes متعددة معاً", () => {
    const model = buildSecurityModel({
      operationSecurity: [{ bearerAuth: [], apiKeyHeader: [] }],
      schemes,
    });
    expect(model.alternatives).toHaveLength(1);
    expect(model.alternatives[0]?.schemes).toHaveLength(2);
  });

  it("scopes تُحفظ كما هي لكل scheme", () => {
    const model = buildSecurityModel({
      operationSecurity: [{ oauth: ["invoices:read", "invoices:write"] }],
      schemes,
    });
    expect(model.alternatives[0]?.schemes[0]?.scopes).toEqual(["invoices:read", "invoices:write"]);
  });
});

describe("الرفض الصريح بدل التخفيض الصامت", () => {
  it("scheme غير معرف في securitySchemes = unknown-scheme", () => {
    const model = buildSecurityModel({ operationSecurity: [{ ghost: [] }], schemes: base.schemes });
    expect(model.unsupported).toEqual([
      expect.objectContaining({ scheme: "ghost", kind: "unknown-scheme" }),
    ]);
  });

  it("http basic وapiKey في query/cookie وmutualTLS = unsupported-type", () => {
    const schemes = schemesOf({
      basic: { type: "http", scheme: "basic" },
      q: { type: "apiKey", in: "query", name: "k" },
      mtls: { type: "mutualTLS" },
    });
    const model = buildSecurityModel({
      operationSecurity: [{ basic: [] }, { q: [] }, { mtls: [] }],
      schemes,
    });
    expect(model.unsupported.map((u) => u.scheme).sort()).toEqual(["basic", "mtls", "q"]);
    expect(model.unsupported.every((u) => u.kind === "unsupported-type")).toBe(true);
  });

  it("oauth2 بتدفق غير مدعوم = unsupported-flow", () => {
    const schemes = schemesOf({ imp: { type: "oauth2", flows: { implicit: {} } } });
    const model = buildSecurityModel({ operationSecurity: [{ imp: [] }], schemes });
    expect(model.unsupported[0]?.kind).toBe("unsupported-flow");
  });

  it("متطلب بنيوي فاسد = malformed-requirement ولا يُتجاهل", () => {
    const model = buildSecurityModel({ operationSecurity: [["not-an-object"]], schemes: base.schemes });
    expect(model.unsupported[0]?.kind).toBe("malformed-requirement");
  });

  it("scopes ليست مصفوفة نصوص = malformed-requirement", () => {
    const model = buildSecurityModel({
      operationSecurity: [{ x: "not-array" }],
      schemes: base.schemes,
    });
    expect(model.unsupported[0]?.kind).toBe("malformed-requirement");
  });
});

describe("استخلاص components.securitySchemes", () => {
  it("يقرأ النوع والـhttp scheme وموضع apiKey والتدفقات", () => {
    const schemes = extractSecuritySchemes({
      components: {
        securitySchemes: {
          a: { type: "http", scheme: "bearer" },
          b: { type: "apiKey", in: "cookie", name: "sid" },
          c: { type: "oauth2", flows: { clientCredentials: {}, password: {} } },
        },
      },
    });
    expect(schemes.get("a")).toEqual({ type: "http", httpScheme: "bearer" });
    expect(schemes.get("b")).toEqual({ type: "apiKey", apiKeyIn: "cookie" });
    expect(schemes.get("c")?.flows).toEqual(["clientCredentials", "password"]);
  });

  it("غياب components يعطي سجلاً فارغاً لا فشلاً", () => {
    expect(extractSecuritySchemes({}).size).toBe(0);
  });
});
