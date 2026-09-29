/** حدود التوليد والخصائص الخاصة؛ البيانات العدائية تُحلل ولا تُنفذ. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { generateServer } from "./emitter.js";
import { injectionInput, structure, diagnostics } from "./injection-fixture.js";

describe("عقود المولد المحدودة", () => {
  it("يرفض __proto__ لأن Zod في SDK لا يحفظ هذا المعامل", () => {
    const result = generateServer(injectionInput("/x/{__proto__}", "__proto__"));
    expect(!result.ok && result.error.code).toBe("GEN_UNSUPPORTED_PARAMETER");
  });
  it("الأسماء المحجوزة تستخدم معرفات مسبوقة ولا تتصادم", () => {
    const input = injectionInput("/x/{id}");
    for (const name of ["class", "default", "constructor", "prototype"]) {
      const result = generateServer({ ...input, designs: input.designs.map((design) => ({ ...design, name })) });
      expect(result.ok).toBe(true);
    }
    const result = generateServer({ ...input, designs: [...input.designs, ...input.designs] });
    expect(!result.ok && result.error.code).toBe("GEN_DUPLICATE_TOOL_NAME");
  });
  it("يرفض أسماء identifiers غير المدعومة دون تعديلها", () => {
    const input = injectionInput("/x/{id}");
    const result = generateServer({ ...input, designs: input.designs.map((design) => ({ ...design, name: "a-b" })) });
    expect(!result.ok && result.error.code).toBe("GEN_INVALID_DESIGN");
  });
  it("يرفض المدخل الكبير ومعامل مسار غير موجود", () => {
    const input = injectionInput("/x/{missing}");
    expect(generateServer(input).ok).toBe(false);
    const result = generateServer(injectionInput("/" + "x".repeat(1048576)));
    expect(!result.ok && result.error.code).toBe("GEN_LIMIT_EXCEEDED");
  });
  it("اسم الخادم لا يخرج من بياناته إلى التعليقات أو الاستيرادات", () => {
    const input = injectionInput("/x/{id}");
    const generate = (serverName: string) => generateServer({ ...input, options: { serverName } });
    const plain = generate("server");
    const hostile = generate("*/\nimport('node:fs');/*\u2028عربي");
    expect(plain.ok && hostile.ok).toBe(true);
    if (!plain.ok || !hostile.ok) return;
    for (const file of hostile.value.files.filter((file) => file.path.endsWith(".ts"))) {
      const baseline = plain.value.files.find((other) => other.path === file.path)?.contents ?? "";
      expect(diagnostics(file.contents)).toEqual([]);
      expect(structure(file.contents)).toEqual(structure(baseline));
      const parsed = ts.createSourceFile(file.path, file.contents, ts.ScriptTarget.ES2022, true);
      const imports = parsed.statements.filter(ts.isImportDeclaration);
      expect(imports.every((item) => ts.isStringLiteral(item.moduleSpecifier))).toBe(true);
    }
  });
});

describe("بوابة الأمن — لا حماية ناقصة بصمت", () => {
  /** يبني مدخلاً بنقطة تحمل نموذجاً أمنياً معطى — الاختبار يسلك بوابة المدقق */
  const withSecurity = (unsupported: unknown, alternatives: unknown = []) => {
    const input = injectionInput("/x/{id}");
    return {
      ...input,
      analyzed: {
        ...input.analyzed,
        spec: {
          ...input.analyzed.spec,
          endpoints: input.analyzed.spec.endpoints.map((endpoint) =>
            endpoint.operationId === "read"
              ? { ...endpoint, security: { alternatives, source: "operation" as const, unsupported } as never }
              : endpoint,
          ),
        },
      },
    };
  };
  it("يرفض التوليد عند scheme غير معرف — بنيوي فاسد لا يولَّد بصمت", () => {
    const result = generateServer(withSecurity([{ scheme: "ghost", kind: "unknown-scheme", reason: "مرجع معلق" }]));
    expect(!result.ok && result.error.code).toBe("GEN_UNSUPPORTED_SECURITY");
  });
  it("يرفض التوليد عند نوع scheme خارج المدعوم (basic مثلاً)", () => {
    const result = generateServer(withSecurity([{ scheme: "legacy", kind: "unsupported-type", reason: "basic" }]));
    expect(!result.ok && result.error.code).toBe("GEN_UNSUPPORTED_SECURITY");
  });
  it("يسير التوليد الطبيعي مع نموذج أمني مدعوم بلا unsupported", () => {
    const result = generateServer(withSecurity([], [{ schemes: [{ name: "bearerAuth", scopes: ["read"] }] }]));
    expect(result.ok).toBe(true);
  });
});
