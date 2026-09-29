/**
 * مقياس الخطورة — المحلل الثالث.
 *
 * الوظيفة: إعطاء درجة خطورة لكل عملية بقواعد نقاط حتمية:
 * - أساس بحسب الفعل: الحذف أخطر من الكتابة وأخطر من القراءة.
 * - وجود PII في حقول العملية يرفع الخطورة درجتين (تسريب بيانات شخصية).
 * - كتابة غير مصادقة ترفع الخطورتين (بوابة مفتوحة بلا حارس).
 * - منطقة إدارية ترفع الدرجة درجة واحدة (ضرر أوسع عند سوء الاستخدام).
 *
 * الخريطة النهائية: ≥4 عالية | 2–3 متوسطة | ≤1 منخفضة.
 * هذه الدرجة تغذي قرار الأداة ودرجة الشهادة لاحقاً.
 */

import type { EndpointKind, NormalizedEndpoint, RiskLevel } from "@agentbridge/shared";
import type { PiiHit } from "@agentbridge/shared";

/** الأساس الخطري لكل فعل HTTP — الحذف 3 لأن أثره لا يُتراجع */
const METHOD_BASE: Readonly<Record<string, number>> = {
  get: 1,
  head: 1,
  options: 1,
  post: 2,
  put: 2,
  patch: 2,
  delete: 3,
};

/**
 * حساب خطورة عملية واحدة.
 * piiHitCount: عدد إصابات PII في حقول هذه العملية تحديداً.
 */
export function scoreEndpointRisk(
  endpoint: NormalizedEndpoint,
  kind: EndpointKind,
  piiHitCount: number,
): RiskLevel {
  let points = METHOD_BASE[endpoint.method] ?? 1;
  if (piiHitCount > 0) points += 2;
  if (!endpoint.requiresAuth && endpoint.method !== "get" && endpoint.method !== "head") points += 2;
  if (kind === "admin") points += 1;

  if (points >= 4) return "high";
  if (points >= 2) return "medium";
  return "low";
}

/** استخلاص عدد إصابات PII التابعة لحقول عملية معينة بمقارنة المؤشرات */
export function countPiiHitsForEndpoint(
  endpoint: NormalizedEndpoint,
  allHits: readonly PiiHit[],
): number {
  const pointers = new Set(endpoint.fields.map((field) => field.pointer));
  return allHits.filter((hit) => pointers.has(hit.pointer)).length;
}
