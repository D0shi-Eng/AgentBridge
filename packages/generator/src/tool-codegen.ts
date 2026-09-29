/**
 * وحدات الكودجن النقية — تحويل تصميم أداة إلى مقاطع كود TypeScript.
 *
 * كل الدوال هنا حتمية ونصية بحتة: نفس المدخل = نفس النص بايت ببايت.
 * لكل سياق عقد مستقل: literal للبيانات وcomputed properties لشكل Zod.
 * المسارات تُركب بنيوياً في source-expressions ولا تدخل قوالب قابلة للتنفيذ.
 */

import type { FieldDescriptor, ParameterSpec, ToolDesign } from "@agentbridge/shared";
import { pathExpression, stringLiteral } from "./source-expressions.js";

/** موقع معامل مدعوم في توليد نداء HTTP (cookie غير مدعوم عمداً) */
export const SUPPORTED_LOCATIONS = new Set(["path", "query", "body", "header"]);

/** تحويل اسم إلى معرف حزمة آمن: صغير، [a-z0-9-] فقط، بلا فراغات */
export function slugifyName(raw: string): string {
  return (
    raw
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "generated-server"
  );
}

/** نص zod literal لنوع معامل واحد حسب النوع المعلن والاختيارية والوصف */
export function zodLiteralFor(param: ParameterSpec): string {
  const base = param.type === "number" ? "z.number()" : param.type === "boolean" ? "z.boolean()" : "z.string()";
  const described = `${base}.describe(${stringLiteral(param.description)})`;
  return param.required ? described : `${described}.optional()`;
}

/** شكل مخطط المعاملات كنص كائن ZodRawShape للأداة الواحدة */
export function buildZodShapeLiteral(design: ToolDesign): string {
  const entries = Object.entries(design.parameters).map(
    ([name, spec]) => `    [${stringLiteral(name)}]: ${zodLiteralFor(spec)},`,
  );
  return entries.length === 0 ? "{}" : `{\n${entries.join("\n")}\n  }`;
}

/** تصنيف معاملات الأداة حسب مواقعها الحقيقية في حقول الطلب */
export interface GroupedParams {
  readonly pathParams: readonly string[];
  readonly queryParams: readonly string[];
  readonly bodyParams: readonly string[];
  readonly headerParams: readonly string[];
}

/** يبحث موقع كل معامل بين حقول الطلب (بعد استبعاد الاستجابات) */
export function groupParametersByLocation(
  design: ToolDesign,
  requestFields: readonly FieldDescriptor[],
): GroupedParams {
  const locationOf = new Map(requestFields.map((field) => [field.name, field.location]));
  const paths: string[] = [];
  const queries: string[] = [];
  const bodies: string[] = [];
  const headers: string[] = [];
  for (const name of Object.keys(design.parameters)) {
    switch (locationOf.get(name)) {
      case "path": paths.push(name); break;
      case "query": queries.push(name); break;
      case "body": bodies.push(name); break;
      case "header": headers.push(name); break;
      default: break; // غير الموجود يرفضه المدقق قبل هنا
    }
  }
  return { pathParams: paths, queryParams: queries, bodyParams: bodies, headerParams: headers };
}

/** واجهة توافق للاسم القديم؛ الناتج تعبير جمع آمن وليس template literal. */
export function buildPathTemplateLiteral(path: string): string {
  return pathExpression(path, false);
}

/** قالب مسار مع تراجع إلى previousResponse للأدوات متعددة النداءات */
export function buildPathTemplateLiteralWithFallback(path: string): string {
  return pathExpression(path, true);
}
