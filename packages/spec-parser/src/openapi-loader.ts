/**
 * محمّل OpenAPI — المدخل الأول لنظام الاستيعاب.
 *
 * الوظيفة: استقبال نص خام (JSON أو YAML) وإخراج كائن مستند مجرد (unknown)
 * دون أي افتراض عن بنيته — التحقق البنيوي مهمة المحقق اللاحق.
 *
 * كيف يعمل:
 * 1) حارس حجم يمنع استنزاف الذاكرة بمواصفة عملاقة.
 * 2) كشف الصيغة: إذا بدأ النص بـ { أو [ نعامله JSON، وإلا YAML.
 * 3) تحليل YAML مع سقف صارم لعدد الأسماء المستعارة لصد قنابل التوسيع
 *    (YAML Bomb) — قرار أمني موثق في ADR-9.
 */

import { parse as parseYaml } from "yaml";
import { err, ok, type Result } from "@agentbridge/shared";
import { SpecErrors } from "./errors.js";

/** الحد الأقصى لحجم المواصفة بالكيلوبايت — فوقه رفض فوري */
export const MAX_SPEC_KB = 2048;

/** السقف الأقصى للأسماء المستعارة في YAML — صد قنابل التوسيع */
const MAX_YAML_ALIASES = 100;

/** نمط بداية مستند JSON صريح */
const JSON_PREFIX = /^[{[]/;

/** هل القيمة كائن مسطح عادي صالح ليكون جذر مستند؟ */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** استخلاص رسالة الخطأ بأمان من رمي مجهول */
function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** تحليل JSON مع تغليف الفشل بخطئنا المنظم */
function parseJson(text: string): Result<unknown> {
  try {
    return ok(JSON.parse(text) as unknown);
  } catch (e: unknown) {
    return err(SpecErrors.syntaxFailed(`JSON: ${describeError(e)}`));
  }
}

/** تحليل YAML مع حماية قنابل الاسم المستعار وتغليف الفشل */
function parseYamlDocument(text: string): Result<unknown> {
  try {
    return ok(parseYaml(text, { maxAliasCount: MAX_YAML_ALIASES }));
  } catch (e: unknown) {
    return err(SpecErrors.syntaxFailed(`YAML: ${describeError(e)}`));
  }
}

/** نقطة الدخول: نص خام → مستند كائن مُتحقق من كونه كائناً فقط */
export function loadDocument(raw: string): Result<Record<string, unknown>> {
  if (raw.length > MAX_SPEC_KB * 1024) return err(SpecErrors.tooLarge(MAX_SPEC_KB));

  const trimmed = raw.trimStart();
  if (trimmed.length === 0) return err(SpecErrors.unsupportedFormat());

  const parsed = JSON_PREFIX.test(trimmed) ? parseJson(trimmed) : parseYamlDocument(trimmed);
  if (!parsed.ok) return parsed;

  if (!isPlainObject(parsed.value)) {
    return err(SpecErrors.invalidStructure("جذر المستند يجب أن يكون كائناً وليس مصفوفة أو قيمة مفردة"));
  }
  return ok(parsed.value);
}
