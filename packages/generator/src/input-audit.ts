/** تدقيق حدود الثقة قبل أي توليد؛ رفض صريح دون تسريب المدخل. */
import { ToolDesignSchema, err, ok, type Result } from "@agentbridge/shared";
import type { GenerationInput } from "./emitter.js";
import { GenErrors } from "./errors.js";
import { SUPPORTED_LOCATIONS } from "./tool-codegen.js";
import { pathParameters } from "./source-expressions.js";
/**
 * التدقيق الدفاعي قبل أي توليد: يعيد خطأً منظماً عند أول شرط فاسد.
 * يكرر بعض فحوص بوابة المصمم عمداً — الحد بين طبقتين مختلفتي الثقة.
 */
export function auditInputs(input: GenerationInput): Result<true> {
  if (input.designs.length === 0) return err(GenErrors.noTools());
  if (input.designs.length > 100 || Buffer.byteLength(JSON.stringify(input)) > 1048576) {
    return err(GenErrors.limitExceeded());
  }

  const seenNames = new Set<string>();
  for (const design of input.designs) {
    if (design.name.length > 100 || design.endpointIds.length > 100 || Object.keys(design.parameters).length > 100) {
      return err(GenErrors.limitExceeded());
    }
    // Zod 3 المستخدم في SDK يسقط __proto__؛ نرفض العقد غير القابل للحفظ بدل إعادة تسميته.
    if (Object.hasOwn(design.parameters, "__proto__")) return err(GenErrors.unsupportedParameter());
    if (!ToolDesignSchema.safeParse(design).success) {
      return err(GenErrors.invalidDesign(design.name));
    }
    if (seenNames.has(design.name)) return err(GenErrors.duplicateToolName(design.name));
    seenNames.add(design.name);

    // كل endpointIds يجب أن يحلّ إلى نقطة موجودة (يدعم التسلسل)
    for (const operationId of design.endpointIds) {
      const endpoint = input.analyzed.spec.endpoints.find((e) => e.operationId === operationId);
      if (endpoint === undefined) return err(GenErrors.unknownEndpoint(operationId));
      // بوابة الأمن: أي scheme غير قابل للنمذجة المدعومة يوقف التوليد —
      // التوليد بحماية أضعف من عقد المواصفة = شهادة زائفة (لا تخفيض صمتاً)
      const unsupported = endpoint.security.unsupported[0];
      if (unsupported !== undefined) {
        return err(GenErrors.unsupportedSecurity(operationId, `${unsupported.scheme || "متطلب بنيوي"}: ${unsupported.reason}`));
      }
    }

    // كل معامل يقابل حقلاً حقيقياً في جهة الطلب لأحد النقاط، وموقعه مدعوم
    const allRequestFields = design.endpointIds.flatMap((operationId) => {
      const endpoint = input.analyzed.spec.endpoints.find((e) => e.operationId === operationId);
      if (endpoint === undefined) return [];
      return endpoint.fields.filter((field) => !field.pointer.includes("/responses/"));
    });
    const fieldLocations = new Map(allRequestFields.map((field) => [field.name, field.location]));
    if (allRequestFields.some((field) => fieldLocations.get(field.name) !== field.location)) {
      return err(GenErrors.unsupportedParameter());
    }
    for (const paramName of Object.keys(design.parameters)) {
      const location = fieldLocations.get(paramName);
      if (location === undefined) return err(GenErrors.unknownParameter(design.name, paramName));
      if (!SUPPORTED_LOCATIONS.has(location)) {
        return err(GenErrors.unsupportedLocation(design.name, paramName, location));
      }
    }
    const first = input.analyzed.spec.endpoints.find((endpoint) => endpoint.operationId === design.endpointIds[0]);
    if (first && pathParameters(first.path).some((name) => !Object.hasOwn(design.parameters, name))) {
      return err(GenErrors.unsupportedParameter());
    }
  }
  return ok(true);
}
