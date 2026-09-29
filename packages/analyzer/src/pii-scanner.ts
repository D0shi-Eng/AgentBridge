/**
 * ماسح البيانات الشخصية (PII) — المحلل الثاني.
 *
 * الوظيفة: رصد حقول البيانات الشخصية عبر كل واصفات الحقول المطبّعة،
 * بقاعدتين متكاملتين:
 * 1) اسم الحقل يطابق قاموس الأنماط → نوع PII محدد.
 * 2) النوع OpenAPI نصي والاسم مطابق نمط بريد/هاتف عام → كشف احتياطي.
 *
 * كل إصابة تحمل مؤشر JsonPointer نحو موضعها الأصلي — لا معلومة مجهولة
 * المصدر في هذا المشروع (بوابة الحقيقة الثالثة).
 */

import type { FieldDescriptor, PiiHit } from "@agentbridge/shared";

/** قاموس الأنماط: نوع PII ← أنماط أسماء الحقول */
const PII_NAME_RULES: ReadonlyArray<{ readonly piiType: string; readonly patterns: readonly RegExp[] }> = [
  { piiType: "email", patterns: [/e[-_]?mail/i] },
  // الهاتف: مطابقة فضفاضة لأن camelCase لا يحفظ حدود الكلمات (ownerPhone)
  { piiType: "phone", patterns: [/phone/i, /mobile/i, /whatsapp/i, /^tel$/i, /^tel_/i, /_tel$/i] },
  {
    piiType: "name",
    patterns: [/first[-_]?name/i, /last[-_]?name/i, /full[-_]?name/i, /display[-_]?name/i, /^name$/i],
  },
  { piiType: "address", patterns: [/address/i, /street/i, /^(city)$/i, /postal[-_]?code/i, /zip[-_]?code/i] },
  {
    piiType: "health",
    patterns: [/diagnos/i, /symptom/i, /(dis)?ease/i, /prescription/i, /medical/i, /blood[-_]?(type|pressure)/i, /patient/i],
  },
  {
    piiType: "financial",
    patterns: [/iban/i, /credit[-_]?card/i, /card[-_]?number/i, /cvv/i, /cvc/i, /salary/i, /bank[-_]?account/i, /^ssn$/i, /national[-_]?id/i, /passport/i],
  },
];

/** نمط شكل البريد الإلكتروني للكشف الاحتياطي على أسماء مثل contact */
const EMAIL_SHAPE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** تصنيف حقل واحد: يعيد نوع PII أو لا شيء */
function detectPiiType(field: FieldDescriptor): string | undefined {
  for (const rule of PII_NAME_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(field.name))) return rule.piiType;
  }
  // الكشف الاحتياطي: قيمة مثال مخزنة باسم عام وبنوع نصي
  if (field.openApiType === "string" && EMAIL_SHAPE.test(field.name)) return "email";
  return undefined;
}

/**
 * مسح قائمة حقول كاملة وإخراج الإصابات بترتيب ثابت.
 * نقية وحتمية: نفس المدخل → نفس الخرج دائماً.
 */
export function scanFieldsForPii(fields: readonly FieldDescriptor[]): readonly PiiHit[] {
  const hits: PiiHit[] = [];
  for (const field of fields) {
    const piiType = detectPiiType(field);
    if (piiType !== undefined) hits.push({ pointer: field.pointer, piiType });
  }
  return hits;
}
