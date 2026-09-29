/**
 * الفحوص البنيوية الأساسية للخادم المولد — النصف الأول من فاحص الحدود.
 *
 * ماهية الكود: دوال نقية على نص ملفات الـartifact تفحص أربعة عقود:
 *   1. كل أداة مسجلة تحمل inputSchema (التحقق قبل التنفيذ).
 *   2. قراءة البيئة محصورة بمفاتيح مسموحة ومطابقة لعقد manifest.
 *   3. manifest لا يكذب: الأدوات المعلنة = المسجلة فعلاً.
 * كيف يعمل: مطابقة نصية حتمية بنوافذ استخلاص — لا قراءة قرص ولا شبكة.
 */

import { ALLOWED_ENV_KEYS, collectEnvKeys } from "./injection-guards.js";

/** نتيجة فحص بنيوية مبسطة: اجتاز أم لا مع تفصيل عربي */
export interface StructuralCheck {
  readonly passed: boolean;
  readonly location?: string;
  readonly detail?: string;
}

/** يستخرج أسماء الأدوات المسجلة من نص tools.ts بترتيبها */
export function extractRegisteredToolNames(source: string): readonly string[] {
  const names: string[] = [];
  for (const match of source.matchAll(/registerTool\(\s*"([a-z][a-z0-9_]*)"/g)) {
    const name = match[1];
    if (name !== undefined) names.push(name);
  }
  return names;
}

/** يستخلص نافذة كود تسجيل أداة معينة — من اسمها حتى إغلاق الاستدعاء */
function registrationWindow(source: string, toolName: string): string | undefined {
  const start = source.indexOf(`registerTool(\n      "${toolName}"`);
  if (start === -1) return source.includes(`"${toolName}"`) ? "" : undefined;
  const end = source.indexOf("\n    );", start);
  return source.slice(start, end === -1 ? undefined : end);
}

/** يفحص أن كل أداة مسجلة مرّرت inputSchema في خيارات التسجيل */
export function checkToolSchemas(toolsSource: string): StructuralCheck {
  const names = extractRegisteredToolNames(toolsSource);
  if (names.length === 0) {
    return { passed: false, location: "src/tools.ts", detail: "لا توجد أدوات مسجلة أصلاً" };
  }
  for (const name of names) {
    const window = registrationWindow(toolsSource, name);
    if (window === undefined || !window.includes("inputSchema")) {
      return {
        passed: false,
        location: `src/tools.ts:${name}`,
        detail: `الأداة ${name} سُجلت دون inputSchema — معاملاتها ستعبر بلا تحقق`,
      };
    }
  }
  return { passed: true };
}

interface ManifestShape {
  env?: { required?: unknown; optional?: unknown };
  tools?: unknown;
}

/** يحلل نص manifest.json بأمان — تالف أو غير كائن يعيد null بدل استثناء */
export function parseManifest(contents: string): ManifestShape | null {
  try {
    const parsed: unknown = JSON.parse(contents);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as ManifestShape;
  } catch {
    return null;
  }
}

/** يستخرج أسماء الأدوات المعلنة في الـmanifest إن كانت مصفوفة كائنات سليمة */
export function extractManifestToolNames(manifest: ManifestShape): readonly string[] | null {
  if (!Array.isArray(manifest.tools)) return null;
  const names: string[] = [];
  for (const entry of manifest.tools) {
    if (typeof entry !== "object" || entry === null) return null;
    const name = (entry as Record<string, unknown>)["name"];
    if (typeof name !== "string") return null;
    names.push(name);
  }
  return names;
}

/**
 * يفحص عقد البيئة: كل مفاتيح القراءة داخل القائمة المسموحة،
 * وmanifest يعلن UPSTREAM_BASE_URL إلزامياً كما يقرأ config.ts فعلاً.
 */
export function checkEnvContract(
  srcSources: Readonly<Record<string, string>>,
  manifest: ManifestShape,
): StructuralCheck {
  const offenders: string[] = [];
  for (const [file, source] of Object.entries(srcSources)) {
    for (const key of collectEnvKeys(source)) {
      if (!ALLOWED_ENV_KEYS.has(key)) offenders.push(`${file}→${key}`);
    }
  }
  if (offenders.length > 0) {
    return {
      passed: false,
      location: offenders[0],
      detail: `قراءة بيئة خارج العقد المسموح: ${offenders.join("، ")}`,
    };
  }

  const required = manifest.env?.required;
  if (!Array.isArray(required) || !required.includes("UPSTREAM_BASE_URL")) {
    return {
      passed: false,
      location: "manifest.json",
      detail: "العقد لا يعلن UPSTREAM_BASE_URL إلزامياً رغم أن config يستلزمه",
    };
  }
  return { passed: true };
}

/** يفحص تطابق الأدوات المعلنة في manifest مع المسجلة فعلاً في tools.ts */
export function checkManifestIntegrity(
  toolsSource: string,
  manifestToolNames: readonly string[],
): StructuralCheck {
  const registered = extractRegisteredToolNames(toolsSource);
  const declared = [...manifestToolNames].sort().join(",");
  const actual = [...registered].sort().join(",");
  if (declared !== actual) {
    return {
      passed: false,
      location: "manifest.json",
      detail: `المعلَن [${declared}] لا يطابق المسجل [${actual}] — manifest يكذب على المستهلك`,
    };
  }
  return { passed: true };
}
