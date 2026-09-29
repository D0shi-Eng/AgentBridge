/**
 * محلل جدوى MCP — المحلل الرابع والحاسم.
 *
 * الوظيفة: الإجابة عن سؤال "هل يستحق هذا الـ endpoint أن يصبح أداة MCP؟".
 * الدرس المستفاد من Pinkfish: ليس كل API يستحق — 3000 API أنتجوا 1000
 * أداة فقط بعد الفلترة. قواعدنا الحتمية:
 *
 * 1) البنية التشغيلية (health/metrics) مرفوضة دائماً — لا قيمة للعميل الوكيل.
 * 2) المنطقة الإدارية تُقبل فقط إذا كانت موثقة (ملخص صريح) — الوكيل يحتاج
 *    فهماً دقيقاً قبل مخاطبة صلاحيات حساسة.
 * 3) أي عملية بلا توثيق (لا summary ولا description ولا حقول) مرفوضة —
 *    أداة غامضة تصنع نداءات خاطئة.
 * 4) ما تبقى (قراءة/كتابة موثقة) مقبول كمرشح أدوات.
 */

import type { EndpointKind, NormalizedEndpoint } from "@agentbridge/shared";

/** هل العملية موثقة بما يكفي ليستوعبها وكيل دون سياق بشري؟ */
function isDocumentedEnough(endpoint: NormalizedEndpoint): boolean {
  // الملخص المطبّع يولّد قالباً افتراضياً "GET /path" عند غياب التوثيق —
  // لذا نعتبر التوثيق حاضراً فقط إن اختلف الملخص عن القالب الافتراضي
  const fallback = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
  const hasRealSummary = endpoint.summary !== fallback;
  return hasRealSummary || endpoint.fields.length > 0;
}

/** قرار الجدوى لعملية واحدة */
export function isMcpWorthy(endpoint: NormalizedEndpoint, kind: EndpointKind): boolean {
  if (kind === "management") return false;
  if (kind === "admin") return isDocumentedEnough(endpoint);
  return isDocumentedEnough(endpoint);
}
