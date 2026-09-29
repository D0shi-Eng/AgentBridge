/**
 * اختبارات فاحص الحدود البنيوية — مخططات الأدوات، عقد البيئة،
 * صدق الـmanifest، وتعقيم رسائل الخطأ.
 */

import { describe, expect, it } from "vitest";
import {
  checkEnvContract,
  checkErrorSanitization,
  checkJwksUrlHttps,
  checkJsonParseProtection,
  checkManifestIntegrity,
  checkToolSchemas,
  extractErrorReturnWindows,
  extractManifestToolNames,
  extractRegisteredToolNames,
  parseManifest,
} from "./scope-checker.js";

/** نموذج تسجيل على صيغة المولّد نفسها لثبات النوافذ */
const SOUND_TOOLS = `import { z } from "zod";
export function registerTools(server: McpServer, config: ServerConfig): void {
    server.registerTool(
      "get_pet",
      { description: "Read a pet.", inputSchema: { petId: z.string() } },
      (args) => execute_get_pet(config, args),
    );
    server.registerTool(
      "list_pets",
      { description: "List pets.", inputSchema: {} },
      () => execute_list_pets(config),
    );
}
`;

describe("extractRegisteredToolNames وcheckToolSchemas", () => {
  it("يستخرج أسماء الأدوات بترتيب التسجيل", () => {
    expect(extractRegisteredToolNames(SOUND_TOOLS)).toEqual(["get_pet", "list_pets"]);
  });

  it("كل أداة بمخطط = نجاح", () => {
    expect(checkToolSchemas(SOUND_TOOLS)).toEqual({ passed: true });
  });

  it("أداة بلا inputSchema تفشل مع تسمية الأداة", () => {
    const source = SOUND_TOOLS.replace("inputSchema: { petId: z.string() } },", "");
    const check = checkToolSchemas(source);
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("get_pet");
  });

  it("ملف بلا أي تسجيلات يفشل صراحة", () => {
    const check = checkToolSchemas("export function registerTools(): void {}");
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("لا توجد أدوات");
  });
});

describe("parseManifest وextractManifestToolNames", () => {
  it("JSON تالف يعيد null بدل استثناء", () => {
    expect(parseManifest("{ ليس json")).toBeNull();
  });

  it("JSON غير كائن (مصفوفة أو رقم) يعيد null", () => {
    expect(parseManifest("[1,2]")).toBeNull();
    expect(parseManifest("42")).toBeNull();
  });

  it("أدوات بأسماء غير نصية تُرفض كلها", () => {
    const manifest = parseManifest(JSON.stringify({ tools: [{ name: "ok" }, { name: 5 }] }));
    expect(manifest).not.toBeNull();
    expect(extractManifestToolNames(manifest as NonNullable<ReturnType<typeof parseManifest>>)).toBeNull();
  });

  it("قائمة أدوات سليمة تستخرج بالترتيب", () => {
    const manifest = parseManifest(JSON.stringify({ tools: [{ name: "a" }, { name: "b" }] }));
    expect(extractManifestToolNames(manifest as NonNullable<ReturnType<typeof parseManifest>>)).toEqual(["a", "b"]);
  });
});

describe("checkEnvContract — عقد البيئة", () => {
  const goodManifest = JSON.stringify({ env: { required: ["UPSTREAM_BASE_URL"], optional: ["UPSTREAM_API_KEY"] } });
  const manifestObject = parseManifest(goodManifest) as NonNullable<ReturnType<typeof parseManifest>>;

  it("مفاتيح مسموحة وعقد مكتمل = نجاح", () => {
    const sources = { "src/config.ts": 'env["UPSTREAM_BASE_URL"]; env["UPSTREAM_API_KEY"];' };
    expect(checkEnvContract(sources, manifestObject)).toEqual({ passed: true });
  });

  it("قراءة بيئة خارج العقد تفشل وتسمي الملف والمفتاح", () => {
    const sources = { "src/tools.ts": "process.env.DEBUG_TELEMETRY_URL" };
    const check = checkEnvContract(sources, manifestObject);
    expect(check.passed).toBe(false);
    if (!check.passed) {
      expect(check.location).toContain("tools.ts");
      expect(check.detail).toContain("DEBUG_TELEMETRY_URL");
    }
  });

  it("عقد لا يعلن UPSTREAM_BASE_URL إلزامياً يفشل حتى لو كانت القراءة نظيفة", () => {
    const weak = parseManifest('{"env":{"required":[]}}') as NonNullable<ReturnType<typeof parseManifest>>;
    const check = checkEnvContract({ "src/config.ts": "" }, weak);
    expect(check.passed).toBe(false);
    if (!check.passed) expect(check.detail).toContain("UPSTREAM_BASE_URL");
  });
});

describe("checkManifestIntegrity — صدق البطاقة", () => {
  it("تطابق كامل = نجاح مهما اختلف الترتيب", () => {
    expect(checkManifestIntegrity(SOUND_TOOLS, ["list_pets", "get_pet"])).toEqual({ passed: true });
  });

  it("نقص أداة معلنة يفشل بالتفصيل", () => {
    const check = checkManifestIntegrity(SOUND_TOOLS, ["get_pet"]);
    expect(check.passed).toBe(false);
    if (!check.passed) expect(check.detail).toContain("get_pet,list_pets");
  });
});

describe("تعقيم رسائل الخطأ", () => {
  const CLEAN = `const r = await callUpstream(config, opts);
  if (!r.ok) {
    return { isError: true, content: [{ type: "text", text: describeUpstreamFailure(r) }] };
  }`;

  it("مسار نظيف عبر describeUpstreamFailure = نجاح", () => {
    expect(checkErrorSanitization(CLEAN)).toEqual({ passed: true });
  });

  it("غياب describeUpstreamFailure كلياً يفشل فوراً", () => {
    const check = checkErrorSanitization('return { isError: true, content: [] };');
    expect(check.passed).toBe(false);
    if (!check.passed) expect(check.detail).toContain("describeUpstreamFailure");
  });

  it("مسار خطأ يضمّ جسم الاستجابة يفشل بالتسمية", () => {
    // تسريب واقعي: الوصف المنظف يُلحق به الجسم السرّي — البوابة تلتقط اللحاق
    const leaky =
      'return { isError: true, content: [{ type: "text", text: `${describeUpstreamFailure(r)}: ${JSON.stringify(r.body)}` }] };';
    const check = checkErrorSanitization(leaky);
    expect(check.passed).toBe(false);
    if (!check.passed) expect(check.detail).toContain("جسم الاستجابة");
  });

  it("extractErrorReturnWindows يستخلص كل النوافذ", () => {
    const windows = extractErrorReturnWindows(CLEAN + "\nreturn { isError: true };");
    expect(windows.length).toBeGreaterThanOrEqual(2);
  });
});

describe("HB-11 JSON.parse بحد حجم (لا نجاح فراغي والملف الصحيح)", () => {
  const files = (contents: string) => new Map([["src/upstream-client.ts", contents]]);

  it("غياب JSON.parse كلياً يفشل — مخالف لعقد المولد لا يمرّ فراغاً", () => {
    const check = checkJsonParseProtection(files("const x = 1;"));
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("JSON.parse");
  });

  it("JSON.parse محمي بحد 524288 في نفس الملف ينجح", () => {
    expect(checkJsonParseProtection(files('if (rawText.length > 524288) return; JSON.parse(rawText);'))).toEqual({ passed: true });
  });

  it("JSON.parse بلا حماية يفشل medium", () => {
    const check = checkJsonParseProtection(files('const obj = JSON.parse(raw);'));
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("JSON.parse");
  });

  it("حماية في ملف واستخدام في آخر = فشل (الملف الصحيح)", () => {
    const sources = new Map([
      ["src/tools.ts", 'if (size > 524288) return; // حارس هنا فقط'],
      ["src/upstream-client.ts", 'const obj = JSON.parse(raw);'],
    ]);
    expect(checkJsonParseProtection(sources).passed).toBe(false);
  });
});

describe("HB-12 jwks https فقط (وعي العقد والملف الصحيح)", () => {
  const files = (contents: string) => new Map([["src/tools.ts", contents]]);

  it("بلا jwks وبدون متطلب في العقد يمر موثقاً بالغياب", () => {
    expect(checkJwksUrlHttps(files('const x = 1;'))).toEqual({ passed: true });
  });

  it("بلا jwks مع متطلب JWKS في عقد البيئة يفشل", () => {
    const check = checkJwksUrlHttps(files('const x = 1;'), { required: true });
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("jwks");
  });

  it("jwksUrl عبر https فقط ينجح", () => {
    const source = 'const jwksUrl = "https://issuer.example.com/.well-known/jwks.json";';
    expect(checkJwksUrlHttps(files(source))).toEqual({ passed: true });
  });

  it("jwksUrl عبر http يفشل medium", () => {
    const source = 'const jwksUrl = "http://issuer.example.com/.well-known/jwks.json";';
    const check = checkJwksUrlHttps(files(source));
    expect(check.passed).toBe(false);
    expect(check.detail).toContain("http");
  });

  it("http مختلط مع https في ملف jwks يفشل — صرامة مقصودة", () => {
    const source = 'const jwksUrl = "http://bad.com/jwks.json"; const good = "https://good.com/jwks.json";';
    const check = checkJwksUrlHttps(files(source));
    expect(check.passed).toBe(false);
  });

  it("يفحص كل ملفات src لا tools.ts وحدها", () => {
    const sources = new Map([
      ['src/tools.ts', 'const x = 1;'],
      ['src/auth.ts', 'const jwks = "http://insecure/jwks";'],
    ]);
    expect(checkJwksUrlHttps(sources).passed).toBe(false);
  });
});
