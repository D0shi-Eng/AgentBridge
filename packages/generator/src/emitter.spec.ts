/** قبول المولد: رفض العقود الفاسدة وحفظ دلالات المسارات الصحيحة. */
import { describe, expect, it } from "vitest";
import { generateServer } from "./emitter.js";
import { analyzed, designs, tinyAnalyzed } from "./emitter-fixture.js";
describe("generateServer — التدقيق الدفاعي", () => {
  it("يرفض الدفعة الفارغة برمز GEN_NO_TOOLS", () => {
    const result = generateServer({ analyzed, designs: [] });
    expect(!result.ok && result.error.code).toBe("GEN_NO_TOOLS");
  });

  it("يرفض تصميماً لا يطابق العقد برمز GEN_INVALID_DESIGN", () => {
    const result = generateServer({
      analyzed,
      designs: [{ ...designs[0]!, name: "Bad Name!" }],
    });
    expect(!result.ok && result.error.code).toBe("GEN_INVALID_DESIGN");
  });

  it("يرفض تكرار اسم الأداة برمز GEN_DUPLICATE_TOOL_NAME", () => {
    const result = generateServer({ analyzed, designs: [designs[0]!, designs[0]!] });
    expect(!result.ok && result.error.code).toBe("GEN_DUPLICATE_TOOL_NAME");
  });

  it("يرفض endpoint وهمياً برمز GEN_UNKNOWN_ENDPOINT", () => {
    const result = generateServer({
      analyzed,
      designs: [{ ...designs[0]!, endpointIds: ["ghostOp"] }],
    });
    expect(!result.ok && result.error.code).toBe("GEN_UNKNOWN_ENDPOINT");
  });

  it("يرفض معاملاً بلا حقل طلب مقابل برمز GEN_UNKNOWN_PARAMETER", () => {
    const result = generateServer({
      analyzed,
      designs: [
        {
          ...designs[1]!,
          parameters: {
            ghostParam: { type: "string", required: true, description: "d" },
          },
        },
      ],
    });
    expect(!result.ok && result.error.code).toBe("GEN_UNKNOWN_PARAMETER");
  });

  it("يرفض موقع معامل غير مدعوم (cookie) برمز GEN_UNSUPPORTED_LOCATION", () => {
    const withCookie = tinyAnalyzed([
      { pointer: "/paths/~1things/{id}/get/parameters/0", name: "sid", location: "cookie", openApiType: "string", required: true },
      { pointer: "/paths/~1things/{id}/get/parameters/1", name: "id", location: "path", openApiType: "string", required: true },
    ]);
    const result = generateServer({
      analyzed: withCookie,
      designs: [
        {
          name: "get_thing",
          description: "Fetch a thing by id.",
          endpointIds: ["getThing"],
          parameters: {
            sid: { type: "string", required: true, description: "session" },
            id: { type: "string", required: true, description: "ident" },
          },
        },
      ],
    });
    expect(!result.ok && result.error.code).toBe("GEN_UNSUPPORTED_LOCATION");
  });
});

describe("generateServer — التركيب الحتمي", () => {
  const result = generateServer({ analyzed, designs });
  if (!result.ok) throw new Error("السيناريو السليم يجب أن يولّد بنجاح");
  const artifact = result.value;

  it("ينتج الملفات الثمانية بالأدوات المرتبة", () => {
    expect(artifact.toolNames).toEqual(["list_pets", "get_pet_by_id"]);
    const paths = artifact.files.map((f) => f.path);
    for (const expected of [
      "package.json",
      "tsconfig.json",
      "src/config.ts",
      "src/upstream-client.ts",
      "src/tools.ts",
      "src/server.ts",
      "manifest.json",
      "README.md",
    ]) {
      expect(paths).toContain(expected);
    }
  });

  it("كود الأدوات يربط المسار الصحيح ومواقع المعاملات", () => {
    const toolsSource = artifact.files.find((f) => f.path === "src/tools.ts")?.contents ?? "";
    expect(toolsSource).toContain('const path = "/pets";');
    expect(toolsSource).toContain('encodeURIComponent(String(own(args, "petId")');
    expect(toolsSource).toContain('query.set("limit", String(value))');
    // وصف الأداة يصل كما صممه الوكيل
    expect(toolsSource).toContain("Retrieve one pet by its unique identifier.");
  });

  it("حتمية بايت-ببايت عبر تشغيلين متتاليين", () => {
    const again = generateServer({ analyzed, designs });
    expect(again.ok && again.value.files).toEqual(artifact.files);
  });

  it("manifest يحمل عقد البيئة والأدوات", () => {
    const manifest = artifact.files.find((f) => f.path === "manifest.json")?.contents ?? "";
    const parsedManifest = JSON.parse(manifest) as {
      env: { required: string[] };
      tools: { name: string }[];
    };
    expect(parsedManifest.env.required).toEqual(["UPSTREAM_BASE_URL"]);
    expect(parsedManifest.tools.map((t) => t.name)).toEqual(artifact.toolNames);
  });
});
