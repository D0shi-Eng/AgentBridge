/**
 * المنفذ العام لحزمة الاستيعاب — النقطة الوحيدة التي يستهلكها العالم.
 *
 * خط المعالجة الحتمي بالترتيب:
 *   تحميل (JSON/YAML) → فحص جذري سريع → حل المراجع → مسح الحقن
 *   → فحص بنيوي كامل → تطبيع.
 *
 * كل خطوة تعيد Result؛ أول فشل يقفل المسار فوراً برسالة عربية ورمز منظّم.
 * ملاحظة أمنية: مسح الحقن يجري بعد حل المراجع حصراً؛ لو سبقهما لبقي النص
 * المستدعى داخل مرجع غير محلول خارج نطاق الفحص فلا يلتقطه الماسح أبدًا.
 */

import type { NormalizedSpec, Result } from "@agentbridge/shared";
import { err, ok } from "@agentbridge/shared";
import { loadDocument } from "./openapi-loader.js";
import { scanForInjection } from "./injection-scan.js";
import { resolveDocument } from "./refs-resolver.js";
import { validateDocument } from "./validator.js";
import { buildNormalizedSpec } from "./normalizer.js";

export { MAX_SPEC_KB } from "./openapi-loader.js";
export { SpecErrors } from "./errors.js";
export {
  SUPPORTED_APIKEY_LOCATIONS,
  SUPPORTED_HTTP_SCHEMES,
  SUPPORTED_SCHEME_TYPES,
  buildSecurityModel,
  extractSecuritySchemes,
  securityRequiresAuth,
} from "./security-model.js";
export type { SecuritySchemeInfo, SecuritySchemes } from "./security-model.js";
export type {
  HttpMethod,
  ValidatedDocument,
  ValidatedOperation,
  ValidatedPathItem,
} from "./validator.js";
export type { InjectionScanResult } from "./injection-scan.js";

/**
 * المدخل الرئيسي: نص خام → مواصفة مطبّعة أو خطأ منظم.
 * هذه الدالة هي العقد الكامل لنظام الاستيعاب تجاه المنسق.
 */
export function parseOpenApiSpec(raw: string): Result<NormalizedSpec> {
  const loaded = loadDocument(raw);
  if (!loaded.ok) return loaded;

  const resolved = resolveDocument(loaded.value);
  if (!resolved.ok) return resolved;

  const injectionScan = scanForInjection(resolved.value);
  if (!injectionScan.clean) return err(injectionScan.error);

  const validated = validateDocument(resolved.value);
  if (!validated.ok) return validated;

  return ok(buildNormalizedSpec(validated.value));
}
