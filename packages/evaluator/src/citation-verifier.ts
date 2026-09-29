/**
 * موثق المصادر citation-verifier — البوابة 3 من طبقة الحقيقة (وثيقة 08).
 *
 * القاعدة: "بلا مرجع = غير موجود". كل تصميم أداة يفحص حتمياً ضد
 * المواصفة المطبّعة قبل دخوله الشهادة:
 *   1. كل endpointIds يشير إلى نقطة موجودة ورُشحت mcpWorthy فعلاً.
 *   2. كل معامل يقابل حقلاً حقيقياً في حقول الطلب لأحد endpoints الأداة.
 *   3. معاملات المسار إلزامية دائماً — لا مسار ناقص قطعة منه.
 *
 * حتمي 100%: لا نموذج ولا شبكة، ونفس المدخل = نفس التقرير بايت ببايت.
 */

import type { AnalyzedSpec, ToolDesign } from "@agentbridge/shared";
import { ok, type Result } from "@agentbridge/shared";

/** مخالفة استشهاد واحدة: أداة + شرح عربي محدد */
export interface CitationViolation {
  readonly toolName: string;
  readonly detail: string;
}

export interface CitationReport {
  readonly checkedTools: number;
  readonly violations: readonly CitationViolation[];
}

/**
 * يفحص كل التصاميم ضد التحليل ويعيد تقرير المخالفات.
 * لا يرمي أبداً — المخالفة بيان قرار لا استثناء.
 */
export function verifyCitations(designs: readonly ToolDesign[], analyzed: AnalyzedSpec): Result<CitationReport> {
  const byId = new Map(analyzed.spec.endpoints.map((endpoint) => [endpoint.operationId, endpoint]));
  const violations: CitationViolation[] = [];

  for (const design of designs) {
    // الفحص 1: المراجع موجودة ومؤهلة فعلاً لتصبح أدوات MCP
    if (design.endpointIds.length === 0) {
      violations.push({ toolName: design.name, detail: "أداة بلا أي مرجع endpoint — ادعاء بلا مصدر" });
      continue;
    }
    const linked = new Set<string>();
    for (const id of design.endpointIds) {
      const endpoint = byId.get(id);
      if (endpoint === undefined) {
        violations.push({
          toolName: design.name,
          detail: `مرجع ${id} غير موجود في المواصفة المطبّعة`,
        });
        continue;
      }
      if (!analyzed.mcpWorthyIds.includes(id)) {
        violations.push({
          toolName: design.name,
          detail: `النقطة ${id} لم ترشحها محللات الجدوى كأداة MCP`,
        });
      }
      linked.add(id);
    }
    if (linked.size === 0 && violations.every((violation) => violation.toolName !== design.name)) {
      violations.push({ toolName: design.name, detail: "أداة بلا أي مرجع صالح" });
    }

    // الفحص 2: المعاملات مأخوذة من حقول الطلب الحقيقية لنقاطها المرتبطة
    const requestFields = new Map<string, string>();
    for (const id of design.endpointIds) {
      const endpoint = byId.get(id);
      if (endpoint === undefined) continue;
      for (const field of endpoint.fields) {
        if (!field.pointer.includes("/responses/")) {
          requestFields.set(field.name, field.location);
        }
      }
    }
    for (const [name, location] of Object.entries(design.parameters)) {
      const actualLocation = requestFields.get(name);
      if (actualLocation === undefined) {
        violations.push({
          toolName: design.name,
          detail: `المعامل ${name} ليس حقلاً طلب معروفاً في النقاط المرتبطة`,
        });
        continue;
      }

      // الفحص 3: معاملات المسار إلزامية بلا استثناء
      if (actualLocation === "path" && !location.required) {
        violations.push({
          toolName: design.name,
          detail: `معامل المسار ${name} وُضع اختيارياً — المسار ينكسر بدونه`,
        });
      }
    }
  }

  return ok({ checkedTools: designs.length, violations });
}
