/**
 * محقق البنية — يفحص المستند المحلَّوم بعد حل مراجعه.
 *
 * الوظيفة: التأكد من أن المستند مطابق للهيكل الأدنى الذي نستطيع
 * العمل عليه (OpenAPI 3.x: openapi/info/paths وعمليات سليمة)، ثم إخراج
 * شكل مكتوب (Typed) يغني المطبّع عن أي فحوص لاحقة.
 *
 * لماذا فحص يدوي بدل مخطط Zod واحد؟ لأن رسائل الرفض هنا عربية موجّهة
 * لصاحب المواصفة، والتحكم الدقيق بالرسائل أسهل يدوياً من خرائط Zod.
 */

import { err, ok, type Result } from "@agentbridge/shared";
import { SpecErrors } from "./errors.js";
import { extractSecuritySchemes } from "./security-model.js";

/** أفعال HTTP المعترف بها داخل Path Item */
export const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** عملية مُتحقق منها — كل حقولها اختيارية إلا موقعها */
export interface ValidatedOperation {
  readonly pathKey: string;
  readonly method: HttpMethod;
  readonly operationId?: string;
  readonly summary?: string;
  readonly description?: string;
  readonly security?: readonly unknown[];
  readonly parameters?: readonly unknown[];
  /** معاملات مستوى المسار التي ترثها كل عملياته */
  readonly inheritedParameters?: readonly unknown[];
  readonly requestBody?: unknown;
  readonly responses?: Readonly<Record<string, unknown>>;
}

/** مسار مُتحقق منه مع عملياته فقط */
export interface ValidatedPathItem {
  readonly path: string;
  readonly operations: readonly ValidatedOperation[];
}

/** المستند كله بعد اجتياز الفحص البنيوي */
export interface ValidatedDocument {
  readonly openapiVersion: string;
  readonly title: string;
  /** متطلبات الأمان العامة على مستوى الجذر — تورَّث لكل عملية بلا security خاصة */
  readonly globalSecurity?: readonly unknown[];
  /** تعريفات schemes من components.securitySchemes — مرجع النموذج الأمني */
  readonly securitySchemes: ReadonlyMap<string, import("./security-model.js").SecuritySchemeInfo>;
  readonly pathItems: readonly ValidatedPathItem[];
}

/** حارس: هل القيمة كائن عادي؟ */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/** قراءة حقل نصي اختياري مع رفض غير النصوص */
function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

/** الفحص السريع لجذر المستند قبل أي جهد أكبر (الحل/المسح) */
export function validateRootShape(doc: Record<string, unknown>): Result<string> {
  const version = doc["openapi"];
  if (version === undefined) return err(SpecErrors.invalidStructure("حقل openapi الإلزامي مفقود"));
  if (typeof version !== "string" || !/^3\.\d+\.\d+$/.test(version)) {
    return err(SpecErrors.unsupportedVersion(String(version)));
  }

  const info = asRecord(doc["info"]);
  if (!info) return err(SpecErrors.invalidStructure("حقل info مفقود أو ليس كائناً"));
  if (typeof info["title"] !== "string" || info["title"].trim().length === 0) {
    return err(SpecErrors.invalidStructure("info.title مفقود أو فارغ"));
  }
  if (typeof info["version"] !== "string") return err(SpecErrors.invalidStructure("info.version مفقود"));

  const paths = asRecord(doc["paths"]);
  if (!paths) return err(SpecErrors.invalidStructure("حقل paths مفقود أو ليس كائناً"));
  if (Object.keys(paths).length === 0) return err(SpecErrors.invalidStructure("لا يحتوي paths أي مسارات — مواصفة بلا نقاط نهاية مرفوضة"));

  return ok(version);
}

/** فحص عملية واحدة واستخلاصها بشكلها المكتوب */
function validateOperation(
  pathKey: string,
  method: HttpMethod,
  raw: unknown,
  inheritedParameters?: readonly unknown[],
): Result<ValidatedOperation> {
  const op = asRecord(raw);
  if (!op) return err(SpecErrors.invalidStructure(`العملية ${method.toUpperCase()} في ${pathKey} ليست كائناً`));

  if (op["parameters"] !== undefined && !Array.isArray(op["parameters"])) {
    return err(SpecErrors.invalidStructure(`parameters يجب أن تكون مصفوفة في ${pathKey} ${method}`));
  }
  if (op["security"] !== undefined && !Array.isArray(op["security"])) {
    return err(SpecErrors.invalidStructure(`security يجب أن يكون مصفوفة في ${pathKey} ${method}`));
  }
  if (op["responses"] !== undefined && !asRecord(op["responses"])) {
    return err(SpecErrors.invalidStructure(`responses يجب أن تكون كائناً في ${pathKey} ${method}`));
  }

  return ok({
    pathKey,
    method,
    operationId: optionalString(op, "operationId"),
    summary: optionalString(op, "summary"),
    description: optionalString(op, "description"),
    security: op["security"] as readonly unknown[] | undefined,
    parameters: op["parameters"] as readonly unknown[] | undefined,
    inheritedParameters,
    requestBody: op["requestBody"],
    responses: asRecord(op["responses"]),
  });
}

/** الفحص الكامل للمستند المحلول: بنية المسارات + تكرار المعرفات */
export function validateDocument(doc: Record<string, unknown>): Result<ValidatedDocument> {
  const versionResult = validateRootShape(doc);
  if (!versionResult.ok) return versionResult;

  const title = (doc["info"] as Record<string, unknown>)["title"] as string;
  const paths = asRecord(doc["paths"]) as Record<string, unknown>;

  // متطلبات الأمان على مستوى الجذر تورَّث لكل عملية لا تعلن security خاصة
  const rawGlobalSecurity = doc["security"];
  if (rawGlobalSecurity !== undefined && !Array.isArray(rawGlobalSecurity)) {
    return err(SpecErrors.invalidStructure("حقل security الجذري يجب أن يكون مصفوفة"));
  }
  const globalSecurity = rawGlobalSecurity as readonly unknown[] | undefined;

  const pathItems: ValidatedPathItem[] = [];
  const seenOperationIds = new Map<string, string>();

  for (const [pathKey, rawItem] of Object.entries(paths)) {
    if (!pathKey.startsWith("/")) {
      return err(SpecErrors.invalidStructure(`اسم المسار يجب أن يبدأ بـ "/": ${pathKey}`));
    }
    const item = asRecord(rawItem);
    if (!item) return err(SpecErrors.invalidStructure(`المسار ${pathKey} ليس كائناً`));

    // معاملات مستوى المسار: يجب أن تكون مصفوفة إن وُجدت، وتورَّث للعمليات
    const rawPathParams = item["parameters"];
    if (rawPathParams !== undefined && !Array.isArray(rawPathParams)) {
      return err(SpecErrors.invalidStructure(`parameters على مستوى المسار ${pathKey} يجب أن تكون مصفوفة`));
    }
    const inheritedParameters = rawPathParams as readonly unknown[] | undefined;

    const operations: ValidatedOperation[] = [];
    for (const method of HTTP_METHODS) {
      if (!(method in item)) continue;
      const validated = validateOperation(pathKey, method, item[method], inheritedParameters);
      if (!validated.ok) return validated;

      const id = validated.value.operationId;
      if (id !== undefined) {
        const owner = seenOperationIds.get(id);
        if (owner !== undefined) {
          return err(SpecErrors.invalidStructure(`operationId مكرر "${id}" في ${owner} و ${pathKey} ${method}`));
        }
        seenOperationIds.set(id, pathKey);
      }
      operations.push(validated.value);
    }

    if (operations.length === 0) {
      return err(SpecErrors.invalidStructure(`المسار ${pathKey} لا يحتوي أي عمليات HTTP`));
    }
    pathItems.push({ path: pathKey, operations });
  }

  return ok({
    openapiVersion: versionResult.value,
    title,
    globalSecurity,
    securitySchemes: extractSecuritySchemes(doc),
    pathItems,
  });
}
