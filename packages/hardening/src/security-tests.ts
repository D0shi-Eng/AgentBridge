/**
 * مجموعة الفحوص الساكنة — اختبارات الاختراق الذاتية على نص الـartifact.
 *
 * عشرة فحوص حتمية (HB-01..HB-10) تغطي العائلات الأمنية الخمس في
 * docs/security.md §5: تنفيذ كود، وصول نظام/صدفة، شبكة خام، أسرار
 * مضمّنة، حقن أوصاف، مخططات معاملات، تعقيم أخطاء، عقد بيئة، صدق manifest.
 *
 * كل فحص يعيد SecurityCheckResult صريحاً؛ التجميع في report.ts.
 */

import type { GeneratedServerArtifact } from "@agentbridge/shared";
import {
  CODE_EXEC_PATTERNS,
  DYNAMIC_IMPORT_PATTERN,
  INJECTION_PATTERNS,
  RAW_NETWORK_PATTERNS,
  SECRET_PATTERNS,
  SHELL_FS_PATTERNS,
  scanContents,
  type PatternHit,
} from "./injection-guards.js";
import type { SecurityCheckResult } from "./report.js";
import { checkAstBoundaries } from "./ast-scope-checker.js";
import {
  checkEnvContract,
  checkErrorSanitization,
  checkJwksUrlHttps,
  checkJsonParseProtection,
  checkManifestIntegrity,
  checkToolSchemas,
  extractManifestToolNames,
  parseManifest,
} from "./scope-checker.js";

/** هل يعلن manifest env مطلوباً يخص مفاتيح الهوية (JWKS)؟ لوعي HB-12 بالعقد */
function manifestRequiresJwks(manifestSource: string | undefined): boolean {
  if (manifestSource === undefined) return false;
  const parsed = parseManifest(manifestSource);
  if (parsed === null) return false;
  const raw = JSON.stringify(parsed);
  return /"JWKS/iu.test(raw);
}

/** ملفات المصدر التي يجري عليها فحص الكود الخطِر */
function srcFiles(artifact: GeneratedServerArtifact): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const file of artifact.files) {
    if (file.path.startsWith("src/") && file.path.endsWith(".ts")) {
      map.set(file.path, file.contents);
    }
  }
  return map;
}

/** أول إصابة نمط عبر مجموعة ملفات — لتوثيق الموضع في النتيجة */
function firstHit(files: ReadonlyMap<string, string>, patterns: readonly RegExp[]): PatternHit | undefined {
  for (const [file, contents] of files) {
    const hits = scanContents(file, contents, patterns);
    if (hits.length > 0) return hits[0];
  }
  return undefined;
}

/** يلف نتيجة نجاح/فشل في شكل الفحص الموحد */
function result(
  id: string,
  title: string,
  severity: SecurityCheckResult["severityIfFailed"],
  category: SecurityCheckResult["category"],
  failure?: { location?: string; detail?: string },
): SecurityCheckResult {
  return {
    id,
    title,
    category,
    severityIfFailed: severity,
    passed: failure === undefined,
    ...(failure?.location !== undefined ? { location: failure.location } : {}),
    ...(failure?.detail !== undefined ? { detail: failure.detail } : {}),
  };
}

/** يحول فحصاً بنيوياً إلى وسيط الإخفاق الموحد — النجاح يعطي undefined */
function failureOf(check: { passed: boolean; location?: string; detail?: string }):
  | { location?: string; detail?: string }
  | undefined {
  return check.passed ? undefined : { location: check.location, detail: check.detail };
}

/**
 * يشغّل الفحوص الساكنة العشرة على الـartifact كاملاً.
 * ترتيب الفحص ثابت حتمياً مهما اختلف محتوى الملفات.
 */
export function runStaticChecks(artifact: GeneratedServerArtifact): readonly SecurityCheckResult[] {
  const sources = srcFiles(artifact);
  const allFiles = new Map(artifact.files.map((file) => [file.path, file.contents]));
  const toolsSource = allFiles.get("src/tools.ts");
  const manifestSource = allFiles.get("manifest.json");
  const manifest = manifestSource !== undefined ? parseManifest(manifestSource) : null;

  const execHit = firstHit(sources, CODE_EXEC_PATTERNS);
  const shellHit = firstHit(sources, SHELL_FS_PATTERNS);
  const networkHit = firstHit(sources, RAW_NETWORK_PATTERNS);
  const dynamicHit = firstHit(sources, [DYNAMIC_IMPORT_PATTERN]);
  const secretTargets = new Map([...sources, ...allFiles].filter(([path]) => path.endsWith(".ts") || path === "manifest.json"));
  const secretHit = firstHit(secretTargets, SECRET_PATTERNS);

  // نصوص موجهة للوكلاء: الأدوات + البطاقة + الدليل — كلها تُفحص ضد الحقن
  const agentFacing = new Map(
    artifact.files
      .filter((file) => ["src/tools.ts", "manifest.json", "README.md"].includes(file.path))
      .map((file) => [file.path, file.contents]),
  );
  const injectionHit = firstHit(agentFacing, INJECTION_PATTERNS);

  const schemaCheck =
    toolsSource !== undefined
      ? checkToolSchemas(toolsSource)
      : { passed: false, location: "src/tools.ts", detail: "ملف الأدوات مفقود من الـartifact" };

  const errorCheck =
    toolsSource !== undefined
      ? checkErrorSanitization(toolsSource)
      : { passed: false, location: "src/tools.ts", detail: "ملف الأدوات مفقود من الـartifact" };

  const envCheck =
    manifest !== null
      ? checkEnvContract(Object.fromEntries(sources), manifest)
      : { passed: false, location: "manifest.json", detail: "manifest مفقود أو تالف — لا يمكن التحقق من عقد البيئة" };

  const manifestToolNames = manifest !== null ? extractManifestToolNames(manifest) : null;
  const integrityCheck =
    manifestToolNames !== null && toolsSource !== undefined
      ? checkManifestIntegrity(toolsSource, manifestToolNames)
      : ({ passed: false, location: "manifest.json", detail: "manifest تالف أو بلا أدوات صالحة" } as const);

  const jsonParseCheck =
    toolsSource !== undefined
      ? checkJsonParseProtection(sources)
      : { passed: false, location: "src/tools.ts", detail: "ملف الأدوات مفقود" };

  // HB-12: يمسح كل ملفات src ويتحقق من عقد البيئة قبل المرور
  const jwksCheck =
    toolsSource !== undefined
      ? checkJwksUrlHttps(new Map([...sources].filter(([path]) => path.endsWith(".ts"))), {
          required: manifestRequiresJwks(manifestSource),
        })
      : { passed: false, location: "src/tools.ts", detail: "ملف الأدوات مفقود — لا يمكن فحص قناة مفاتيح الهوية" };

  // HB-13: مسح AST دلالي فوق النصي — يفشل على شجرة فارغة أيضاً
  const astCheck = checkAstBoundaries(sources);

  return [
    result("HB-01", "لا تنفيذ كود ديناميكي (eval/Function)", "critical", "dangerous-code",
      execHit && { location: `${execHit.file}:${execHit.line}`, detail: `نمط خطِر: ${execHit.excerpt}` }),
    result("HB-02", "لا وصول لنظام الملفات أو الصدفة", "critical", "dangerous-code",
      shellHit && { location: `${shellHit.file}:${shellHit.line}`, detail: `نمط خطِر: ${shellHit.excerpt}` }),
    result("HB-03", "لا شبكة خام خارج قناة upstream المرخصة", "high", "dangerous-code",
      networkHit && { location: `${networkHit.file}:${networkHit.line}`, detail: `استيراد شبكة غير مرخص: ${networkHit.excerpt}` }),
    result("HB-04", "لا استيراد ديناميكي import()", "high", "dangerous-code",
      dynamicHit && { location: `${dynamicHit.file}:${dynamicHit.line}`, detail: `استيراد ديناميكي: ${dynamicHit.excerpt}` }),
    result("HB-05", "لا أسرار مضمنة حرفياً", "critical", "secrets",
      secretHit && { location: `${secretHit.file}:${secretHit.line}`, detail: `سر مضمّن: ${maskExcerpt(secretHit.excerpt)}` }),
    result("HB-06", "أوصاف الأدوات نظيفة من حقن التعليمات", "high", "injection",
      injectionHit && { location: `${injectionHit.file}:${injectionHit.line}`, detail: `نمط حقن: ${injectionHit.excerpt}` }),
    result("HB-07", "كل أداة مسجلة بمخطط تحقق inputSchema", "high", "schema", failureOf(schemaCheck)),
    result("HB-08", "رسائل الخطأ معقمة ولا تمرر جسم الاستجابة", "high", "errors", failureOf(errorCheck)),
    result("HB-09", "قراءة البيئة محصورة بعقد manifest المسموح", "medium", "env", failureOf(envCheck)),
    result("HB-10", "manifest صادق: المعلَن = المسجل فعلاً", "medium", "manifest", failureOf(integrityCheck)),
    result("HB-11", "JSON.parse محمي بحد حجم 512KB", "medium", "dangerous-code", failureOf(jsonParseCheck)),
    result("HB-12", "jwksUrl عبر https فقط ويُحجب http", "medium", "secrets", failureOf(jwksCheck)),
    result("HB-13", "مسح AST لحدود التنفيذ (استيرادات/استدعاءات)", "high", "dangerous-code", failureOf(astCheck)),
  ];
}

/** يحجب قيمة السر المكتشف في التوثيق — لا نكرر تسريبه في تقريرنا */
function maskExcerpt(excerpt: string): string {
  return excerpt.slice(0, 24) + "…[محجوب]";
}
