/**
 * المنفذ العام لحزمة التحليل — العقد الكامل للنظام الثاني.
 *
 * الوظيفة: أخذ مواصفة مطبّعة وتشغيل المحللات الأربعة عليها بالترتيب:
 *   تصنيف ← مسح PII ← خطورة ← جدوى MCP
 * وإخراج AnalyzedSpec واحدة تحمل المواصفة + طبقة القرارات فوقها.
 *
 * كل محلل نقي ومستقل؛ هذا الملف مجرد منسق محلي صغير بينها.
 * ملاحظة معمارية: التحليل لا يفشل أبداً — مدخله مواصفة اجتازت الاستيعاب،
 * فلا Result هنا بل خرج مباشر (انظر وثيقة 03 الأنظمة).
 */

import type { AnalyzedSpec, EndpointKind, NormalizedSpec, PiiHit, RiskLevel } from "@agentbridge/shared";
import { classifyEndpoint } from "./endpoint-classifier.js";
import { scanFieldsForPii } from "./pii-scanner.js";
import { countPiiHitsForEndpoint, scoreEndpointRisk } from "./risk-scorer.js";
import { isMcpWorthy } from "./mcp-worthiness.js";

export { classifyEndpoint } from "./endpoint-classifier.js";
export { scanFieldsForPii } from "./pii-scanner.js";
export { countPiiHitsForEndpoint, scoreEndpointRisk } from "./risk-scorer.js";
export { isMcpWorthy } from "./mcp-worthiness.js";

/**
 * المدخل الرئيسي: مواصفة مطبّعة → تحليل كامل.
 * حتمية كاملة: نفس المواصفة تعطي نفس التحليل في كل تشغيل.
 */
export function analyzeSpec(spec: NormalizedSpec): AnalyzedSpec {
  const kinds: Record<string, EndpointKind> = {};
  const risks: Record<string, RiskLevel> = {};
  const mcpWorthyIds: string[] = [];

  // المرحلة أ: المسح الشامل لكل الحقول — الإصابات تجمع مرة واحدة ثم توزع
  const piiHits: PiiHit[] = spec.endpoints.flatMap((endpoint) => scanFieldsForPii(endpoint.fields));

  // المرحلة ب: قرارات كل عملية على حدة
  for (const endpoint of spec.endpoints) {
    const kind = classifyEndpoint(endpoint.path, endpoint.method);
    const risk = scoreEndpointRisk(endpoint, kind, countPiiHitsForEndpoint(endpoint, piiHits));

    kinds[endpoint.operationId] = kind;
    risks[endpoint.operationId] = risk;
    if (isMcpWorthy(endpoint, kind)) mcpWorthyIds.push(endpoint.operationId);
  }

  return { spec, kinds, risks, piiHits, mcpWorthyIds };
}
