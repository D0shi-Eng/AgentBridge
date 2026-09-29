/**
 * الفاحص الدلالي للحدود — AST حقيقي بدل regex على النص.
 *
 * ماهيته: مسح بنية شجرة الطبع لكل ملف src/*.ts في الـartifact عبر
 * مترجم TypeScript (نفس النسخة في المستودع — لا مكتبة جديدة)، وجمع:
 *   1. مصادر الاستيراد الثابتة (ImportDeclaration/ExportDeclaration/require).
 *   2. الاستيراد الديناميكي import() — عقدة ImportCall منفصلة عن النص.
 *   3. الاستدعاءات: eval وFunction وrequire بأي مستقبل (globalThis.eval...).
 *   4. وصول الأعضاء والفهارس الخطرة: process.binding وglobalThis["ev"+"al"]
 *      بحساب الفهرس النصي عند ثباته.
 *
 * حدود الفاحص (ملزمة — لا ادعاء تحليل تدفق كامل):
 * - يكشف الاستخدام البنيوي (استيراد/استدعاء/وصول عضو) ولا يتتبع تلوث
 *   البيانات؛ سلسلة مبنية ديناميكياً بغير محارف ثابتة قد لا تُنسب
 *   لمستقبلها — يغطيها سقف "استدعاء غير محل الاسم" جزئياً لا كلياً.
 * - لا ينفذ الكود ولا يحمّل imports — تحليل نحوي-دلالي ساكن فقط.
 * - النجاح يعني "لا استخدام بنيوي خطِر في النطاق الممسوح" لا "الخادم آمن".
 *
 * تشديد نهائي (corpus مرجعي موسع):
 * - **فشل مغلق على syntax التالف**: ملف لا يُفسر كلياً يُرفض (لا مناطق
 *   معتمة يختبئ فيها بناء خطِر) — رفض تحفظي مقصود.
 * - **الأسماء الممنوعة على مستوى المعرف كله** لا عند موضع الاستدعاء فقط:
 *   يقطع aliases (const e = eval)، التمرير غير المباشر (Reflect.apply(eval,…))،
 *   وإعلان الظل — رفض تحفظي: لا مبرر مشروع لظهور هذه الأسماء في خادم مولد.
 * - **الفهرسة المحسوبة غير البسيطة ترفض** (["ev"+"al"] و[`te${x}mp`]) —
 *   الفهرس النصي الثابت أو معرف بسيط يبقى مشروعاً (وصول params/خرائط).
 */

import ts from "typescript";
import type { SecurityCheckResult } from "./report.js";

/** وحدات وأعضاء ممنوعون بنيوياً في الكود المولد — خارج قناة upstream */
const DENIED_MODULES = new Set([
  "child_process", "node:child_process", "fs", "node:fs", "fs/promises", "node:fs/promises",
  "net", "node:net", "http", "node:http", "http2", "node:http2", "https", "node:https",
  "dgram", "node:dgram", "dns", "node:dns", "vm", "node:vm", "worker_threads", "node:worker_threads",
  "cluster", "node:cluster", "os", "node:os", "process", "node:process",
]);

/** أسماء استدعاء/وصول ممنوعة مهما كان مستقبلها */
const DENIED_CALLS = new Set(["eval", "Function", "require", "exec", "execSync", "spawn", "spawnSync"]);
const DENIED_MEMBERS = new Set(["binding", "dlopen", "setImmediateUnsafe", "eval"]);

/** نتيجة إصابة داخلية قبل تحويلها لنتيجة فحص موحدة */
interface Violation {
  readonly file: string;
  readonly line: number;
  readonly kind: string;
  readonly name: string;
}

/** يستخلص اسم مستقبل استدعاء بنيوياً: معرف أو سلسلة وصول أعضاء */
function calleeName(node: ts.CallExpression | ts.NewExpression | ts.TaggedTemplateExpression): string | undefined {
  const expr = ts.isCallExpression(node) || ts.isNewExpression(node) ? node.expression : node.tag;
  if (ts.isIdentifier(expr)) return expr.text;
  if (ts.isPropertyAccessExpression(expr) && ts.isIdentifier(expr.name)) return expr.name.text;
  // فهرس نصي ثابت: globalThis["eval"] — يُعامل كوصول عضو
  if (ts.isElementAccessExpression(expr) && expr.argumentExpression !== undefined) {
    const literal = expr.argumentExpression;
    if (ts.isStringLiteral(literal)) return literal.text;
  }
  return undefined;
}

/** يمسح ملفاً واحداً ويدفع الانتهاكات إلى قائمة — زيارة كاملة للشجرة */
function scanFile(file: string, source: string, violations: Violation[]): void {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  // فشل مغلق: syntax لا يُفسر كلياً = ملف مرفوض كله — لا منطقة معتمة
  const parseDiagnostics = (parsed as unknown as { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (parseDiagnostics.length > 0) {
    const first = parseDiagnostics[0];
    const start = first?.start ?? 0;
    const line = parsed.getLineAndCharacterOfPosition(start).line + 1;
    violations.push({ file, line, kind: "parse-error", name: "malformed-syntax" });
    return;
  }
  const visit = (node: ts.Node): void => {
    const line = parsed.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    if (ts.isImportDeclaration(node) || (ts.isExportDeclaration(node) && node.moduleSpecifier !== undefined)) {
      const specifier = node.moduleSpecifier;
      if (specifier !== undefined && ts.isStringLiteral(specifier) && DENIED_MODULES.has(specifier.text)) {
        violations.push({ file, line, kind: "import", name: specifier.text });
      }
    } else if (ts.isCallExpression(node)) {
      // استيراد ديناميكي import(): عقدة خاصة لا TextNode — يُمسك بنيوياً
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        violations.push({ file, line, kind: "dynamic-import", name: "import()" });
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        violations.push({ file, line, kind: "require", name: "require" });
      } else {
        const name = calleeName(node);
        if (name !== undefined && DENIED_CALLS.has(name)) violations.push({ file, line, kind: "call", name });
      }
    } else if (ts.isNewExpression(node)) {
      const name = calleeName(node);
      if (name !== undefined && DENIED_CALLS.has(name)) violations.push({ file, line, kind: "new", name });
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
      // سلسلة prototype الكلاسيكية: X.constructor.constructor(...) — رفض تحفظي
      // (الوصول لـconstructor مرة واحدة مشروع بنيوياً، الترهيم المزدوج نمط هروب)
      if (
        node.name.text === "constructor"
        && ts.isPropertyAccessExpression(node.expression)
        && ts.isIdentifier(node.expression.name)
        && node.expression.name.text === "constructor"
      ) {
        violations.push({ file, line, kind: "prototype-escape", name: "constructor.constructor" });
      } else if (DENIED_MEMBERS.has(node.name.text)) {
        violations.push({ file, line, kind: "member", name: node.name.text });
      }
    } else if (ts.isElementAccessExpression(node) && node.argumentExpression !== undefined) {
      const literal = node.argumentExpression;
      if (ts.isStringLiteral(literal) && DENIED_CALLS.has(literal.text)) {
        violations.push({ file, line, kind: "indexed-access", name: literal.text });
      } else if (!ts.isStringLiteral(literal) && !ts.isNumericLiteral(literal) && !ts.isIdentifier(literal)) {
        // فهرسة محسوبة غير بسيطة (دمج نصوص/قوالب) — رفض تحفظي:
        // الوصول المشروع للخادم المولد نص ثابت أو معرف بسيط حصراً
        violations.push({ file, line, kind: "dynamic-index", name: "computed-member" });
      }
    }
    // الاسم الممنوع ممنوع في أي موضع معرف — يقطع aliases
    // والتمرير غير المباشر والإعلان الظل (لا مبرر مشروع لها في مولد).
    // الاستثناء الوحيد: موضع اسم العضو في الوصول بالنقطة (obj.eval) —
    // يمسكه قاعدة الأعضاء أعلاه بدل ازدواج الحكم
    if (ts.isIdentifier(node) && DENIED_CALLS.has(node.text)) {
      const parent = node.parent;
      const isPropertyName = ts.isPropertyAccessExpression(parent) && parent.name === node;
      if (!isPropertyName) violations.push({ file, line, kind: "identifier", name: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(parsed);
}

/** عتبة قصوى للانتهاكات المجمعة — تفاصيل كثيرة تعني حجباً منظماً لا نماذج */
const MAX_REPORTED_VIOLATIONS = 5;

/**
 * فحص HB-13: مسح AST لحدود التنفيذ — يفشل عند أي استخدام بنيوي خطِر
 * ويفشل عند غياب الملفات أصلاً (لا نجاح فراغي على شجرة فارغة).
 */
export function checkAstBoundaries(sources: ReadonlyMap<string, string>): SecurityCheckResult {
  if (sources.size === 0) {
    return {
      id: "HB-13", title: "مسح AST لحدود التنفيذ (استيرادات/استدعاءات)", category: "dangerous-code",
      severityIfFailed: "high", passed: false, location: "src/*",
      detail: "لا ملفات مصدر للمسح — لا نجاح فراغي على فحص لم يمس شيئاً",
    };
  }
  const violations: Violation[] = [];
  for (const [file, contents] of sources) scanFile(file, contents, violations);
  if (violations.length === 0) {
    return { id: "HB-13", title: "مسح AST لحدود التنفيذ (استيرادات/استدعاءات)", category: "dangerous-code", severityIfFailed: "high", passed: true };
  }
  const shown = violations.slice(0, MAX_REPORTED_VIOLATIONS)
    .map((v) => `${v.file}:${v.line} ${v.kind}(${v.name})`).join("؛ ");
  return {
    id: "HB-13", title: "مسح AST لحدود التنفيذ (استيرادات/استدعاءات)", category: "dangerous-code",
    severityIfFailed: "high", passed: false,
    location: `${violations[0]?.file ?? "src"}:${violations[0]?.line ?? 0}`,
    detail: `${violations.length} استخداماً بنيوياً خطِراً — منها: ${shown}`,
  };
}
