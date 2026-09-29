/**
 * مستخلص الحقول — يستخرج كل حقول العملية كواصفات جاهزة لماسح PII.
 *
 * الوظيفة: من عملية مُتحققة واحدة إلى قائمة FieldDescriptor تشمل:
 * المعاملات (path/query/header/cookie) وحقول جسم الطلب والاستجابات.
 * كل واصف يحمل مؤشر JsonPointer نحو أصله في المستند الأصلي
 * حتى تبقى كل معلومة لاحقاً قابلة للإسناد لسطرها في المواصفة.
 */

import type { FieldDescriptor, FieldLocation } from "@agentbridge/shared";
import type { ValidatedOperation } from "./validator.js";

/** حد عمق تفكيك مخطط الجسم — يوقف تفرّع النماذج الذاتية بأمان */
export const MAX_SCHEMA_DEPTH = 6;

/** مواقع المعاملات المعترف بها خارج الجسم */
const PARAM_LOCATIONS: ReadonlySet<string> = new Set(["path", "query", "header", "cookie"]);

/** تهريب رموز خاصة في مقطع من JsonPointer */
function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** هل القيمة كائن عادي؟ */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** بناء واصف حقل من معامل OpenAPI واحد، أو تجاهله إن كان شاذ البنية */
function fieldFromParameter(param: Record<string, unknown>, pointer: string): FieldDescriptor | undefined {
  const name = param["name"];
  const locationRaw = param["in"];
  if (typeof name !== "string" || typeof locationRaw !== "string") return undefined;
  if (!PARAM_LOCATIONS.has(locationRaw)) return undefined;

  const schema = asRecord(param["schema"]);
  return {
    pointer,
    name,
    location: locationRaw as FieldLocation,
    openApiType: typeof schema?.["type"] === "string" ? (schema["type"] as string) : "unknown",
    // معامل المسار إلزامي بحكم التعريف حتى لو أغفل الكاتب الراية
    required: locationRaw === "path" ? true : param["required"] === true,
  };
}

/**
 * تفكيك مخطط JSON Schema إلى حقول مسطحة.
 * الكائنات المتداخلة تنضم بأسماء مركبة (address.city) والمصفوفات بلاحقة [].
 * المرجع الذاتي المتبقي ($ref غير المحلول) يوقف التفريع — قرار الحلال.
 */
function flattenSchema(
  schema: Record<string, unknown>,
  basePointer: string,
  namePath: string,
  location: FieldLocation,
  out: FieldDescriptor[],
  depth: number,
): void {
  if (depth > MAX_SCHEMA_DEPTH || "$ref" in schema) return;

  // مخطط المصفوفة الجذرية: فك عناصرها بنفس مسمى المستوى الأب
  if (schema["type"] === "array") {
    const items = asRecord(schema["items"]);
    if (items) flattenSchema(items, `${basePointer}/items`, namePath, location, out, depth + 1);
    return;
  }

  const properties = asRecord(schema["properties"]);
  if (!properties) return;

  const requiredList = Array.isArray(schema["required"]) ? (schema["required"] as unknown[]) : [];

  for (const [key, rawProp] of Object.entries(properties)) {
    const propSchema = asRecord(rawProp);
    if (!propSchema) continue;

    const fullName = namePath.length === 0 ? key : `${namePath}.${key}`;
    out.push({
      pointer: `${basePointer}/properties/${escapePointerToken(key)}`,
      name: fullName,
      location,
      openApiType: typeof propSchema["type"] === "string" ? (propSchema["type"] as string) : "unknown",
      required: requiredList.includes(key),
    });

    if (propSchema["type"] === "object") {
      flattenSchema(propSchema, `${basePointer}/properties/${escapePointerToken(key)}`, fullName, location, out, depth + 1);
    } else if (propSchema["type"] === "array" && asRecord(propSchema["items"])?.["type"] === "object") {
      flattenSchema(asRecord(propSchema["items"]) as Record<string, unknown>, `${basePointer}/properties/${escapePointerToken(key)}/items`, `${fullName}[]`, location, out, depth + 1);
    }
  }
}

/** جمع الحقول من مخاطب محتوى واحد (طلب أو استجابة) */
function collectFromContent(
  content: Record<string, unknown>,
  basePointer: string,
  location: FieldLocation,
  out: FieldDescriptor[],
): void {
  // ترتيب أبجدي ثابت لأنواع المحتوى لضمان حتمية ترتيب الحقول الناتجة
  const mediaTypes = Object.keys(content).sort();
  for (const mediaType of mediaTypes) {
    const mediaObject = asRecord(content[mediaType]);
    const schema = mediaObject ? asRecord(mediaObject["schema"]) : undefined;
    if (schema && !("$ref" in schema)) {
      flattenSchema(schema, `${basePointer}/${escapePointerToken(mediaType)}/schema`, "", location, out, 0);
    }
  }
}

/** المدخل الوحيد: عملية كاملة → كل حقولها مرتبة ومؤشّرة */
export function extractOperationFields(op: ValidatedOperation): readonly FieldDescriptor[] {
  const fields: FieldDescriptor[] = [];
  const opBase = `/paths/${escapePointerToken(op.pathKey)}/${op.method}`;

  // 1) المعاملات على مستوى العملية ثم مستوى المسار (يرثها كل الأفعال)
  const pathLevelParams = op.inheritedParameters ?? [];
  const allParams = [...pathLevelParams, ...(op.parameters ?? [])];
  allParams.forEach((rawParam, index) => {
    const param = asRecord(rawParam);
    if (!param) return;
    const descriptor = fieldFromParameter(param, `${opBase}/parameters/${index}`);
    if (descriptor !== undefined) fields.push(descriptor);
  });

  // 2) حقول جسم الطلب
  const requestBody = asRecord(op.requestBody);
  const content = requestBody ? asRecord(requestBody["content"]) : undefined;
  if (content) collectFromContent(content, `${opBase}/requestBody/content`, "body", fields);

  // 3) حقول الاستجابات — مهمة لماسح PII لأن التسريب غالباً في الإخراج
  if (op.responses) {
    for (const status of Object.keys(op.responses).sort()) {
      const response = asRecord(op.responses[status]);
      const responseContent = response ? asRecord(response["content"]) : undefined;
      if (responseContent) {
        collectFromContent(responseContent, `${opBase}/responses/${status}/content`, "body", fields);
      }
    }
  }

  return fields;
}
