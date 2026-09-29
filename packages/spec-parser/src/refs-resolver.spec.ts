/**
 * اختبارات حلال المراجع — سلوكياته الدقيقة: الذاكرة، الحلقات الذاتية، الرفض.
 */

import { describe, expect, it } from "vitest";
import { resolveDocument } from "./refs-resolver.js";

describe("حل المراجع الداخلية", () => {
  it("يحل مرجعاً بسيطاً ويستبدله بقيمته", () => {
    const doc = {
      a: { $ref: "#/defs/thing" },
      defs: { thing: { color: "red" } },
    };
    const r = resolveDocument(doc);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.value["a"] as Record<string, unknown>)["color"]).toBe("red");
  });

  it("يتذكر المرجع المحلول فيستخدمه مرة واحدة لكل التكرارات", () => {
    const doc = {
      x: { $ref: "#/d/v" },
      y: { $ref: "#/d/v" },
      d: { v: { n: 7 } },
    };
    const r = resolveDocument(doc);
    if (r.ok) {
      expect((r.value["x"] as Record<string, unknown>)["n"]).toBe(7);
      expect((r.value["y"] as Record<string, unknown>)["n"]).toBe(7);
    }
  });

  it("يفك ترميز رموز المؤشر (~0 و ~1)", () => {
    const doc = {
      ref: { $ref: "#/a~1b/x~0y" },
      "a/b": { "x~y": 42 },
    };
    const r = resolveDocument(doc);
    if (r.ok) expect(r.value["ref"]).toBe(42);
  });
});

describe("الحلقات الذاتية مشروعة", () => {
  it("يوقف توسيع النموذج الذي يشير لنفسه دون تجمد أو فشل", () => {
    const doc = {
      root: { $ref: "#/schemas/Node" },
      schemas: {
        Node: {
          type: "object",
          properties: { child: { $ref: "#/schemas/Node" } },
        },
      },
    };
    const r = resolveDocument(doc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // المستوى الأول محلول، والمرجع الذاتي داخل الخصائص يبقى كما هو كسر للدورة
    const node = r.value["root"] as Record<string, unknown>;
    const props = node["properties"] as Record<string, Record<string, unknown>>;
    expect(props["child"]?.["$ref"]).toBe("#/schemas/Node");
  });
});

describe("الرفض المنظم", () => {
  it("يرفض المرجع الخارجي", () => {
    const r = resolveDocument({ a: { $ref: "https://x.example/y#/Z" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SPEC_EXTERNAL_REF");
  });

  it("يرفض مرجع الموقع المفقود", () => {
    const r = resolveDocument({ a: { $ref: "#/nowhere/at/all" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SPEC_BROKEN_REF");
  });

  it("يرفض المسار العابر عبر قيمة غير قابلة للتصفح", () => {
    const r = resolveDocument({ leaf: 5, a: { $ref: "#/leaf/deeper" } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("SPEC_BROKEN_REF");
  });
});
