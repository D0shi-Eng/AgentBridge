/**
 * المطبّع — يحوّل المستند المُتحقق منه إلى NormalizedSpec مسطّحة.
 *
 * الوظيفة: توحيد شكل كل عملية مهما كان أسلوب كاتب المواصفة:
 * - operationId مولّد آمناً إن غاب، مع كشف التعارض مع المولدين.
 * - ملخص حتمي: summary ثم description ثم قالب موحد.
 * - حقول العملية تُستخلَم عبر fields-extractor.
 * - القرار الأمني عبر security-model: نموذج faithful (OR/AND/scopes) مع
 *   الأولوية: security العملية ثم الجذر؛ [] = عام إعلاناً؛ والغياب غياب.
 *
 * هذه المرحلة نقية 100%: لا فشل بعد نجاح الفاحص، لا حالة، صفر نداءات LLM.
 */

import type { NormalizedEndpoint, NormalizedSpec } from "@agentbridge/shared";
import { extractOperationFields } from "./fields-extractor.js";
import { buildSecurityModel, securityRequiresAuth } from "./security-model.js";
import type { ValidatedDocument, ValidatedOperation } from "./validator.js";

/** توليد معرف عملية آمن من المسار والفعل عند غياب operationId */
function synthesizeOperationId(path: string, method: string): string {
  const cleaned = path
    .replace(/[{}]/g, "") // أقواس معاملات المسار
    .replace(/[^a-zA-Z0-9]+/g, "_") // أي فاصل يصير شرطة سفلية
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return `${method}_${cleaned}`;
}

/** الملخص الحتمي بترتيب أولوية ثابت */
function buildSummary(op: ValidatedOperation): string {
  if (op.summary !== undefined && op.summary.trim().length > 0) return op.summary.trim();
  if (op.description !== undefined && op.description.trim().length > 0) return op.description.trim();
  return `${op.method.toUpperCase()} ${op.pathKey}`;
}

/** أسماء معاملات المسار: من المعاملات المصرَّحة ومن قوالب {token} في المسار */
function collectPathParams(path: string, op: ValidatedOperation): readonly string[] {
  const declared = new Set<string>();
  for (const rawParam of [...(op.inheritedParameters ?? []), ...(op.parameters ?? [])]) {
    const param = typeof rawParam === "object" && rawParam !== null ? (rawParam as Record<string, unknown>) : {};
    if (param["in"] === "path" && typeof param["name"] === "string") declared.add(param["name"]);
  }
  // التقاط القوالب التي أغفلها الكاتب — العميل سيفشل لو لم تُعرَّف أصلاً، لكن التطبيع يكمل
  const templates = [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
  return [...new Set([...declared, ...templates.filter((t) => t.length > 0)])];
}

/** تحويل عملية واحدة إلى نظيرتها المطبّعة */
function normalizeOperation(op: ValidatedOperation, validated: ValidatedDocument): NormalizedEndpoint {
  const explicitId = op.operationId;
  const generatedId = synthesizeOperationId(op.pathKey, op.method);
  // إن وُجد معرف مصرح به نستخدمه؛ وإلا المولد — والتعارض اكتشفه الفاحص مسبقاً
  const operationId = explicitId !== undefined && explicitId.trim().length > 0 ? explicitId : generatedId;
  // نموذج أمني faithful لا اختزال boolean — العملية تتقدم على الجذر
  const security = buildSecurityModel({
    operationSecurity: op.security,
    globalSecurity: validated.globalSecurity,
    schemes: validated.securitySchemes,
  });

  return {
    path: op.pathKey,
    method: op.method,
    operationId,
    summary: buildSummary(op),
    pathParams: collectPathParams(op.pathKey, op),
    requiresAuth: securityRequiresAuth(security),
    security,
    fields: extractOperationFields(op),
  };
}

/** المدخل الوحيد للمطبّع: مستند مُتحقق → مواصفة مطبّعة كاملة */
export function buildNormalizedSpec(validated: ValidatedDocument): NormalizedSpec {
  const endpoints: NormalizedEndpoint[] = [];
  for (const pathItem of validated.pathItems) {
    for (const operation of pathItem.operations) {
      endpoints.push(normalizeOperation(operation, validated));
    }
  }
  return {
    title: validated.title,
    openapiVersion: validated.openapiVersion,
    endpointCount: endpoints.length,
    endpoints,
  };
}
