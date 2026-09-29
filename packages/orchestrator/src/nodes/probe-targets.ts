/**
 * اشتقاق أهداف الفحص الحي حتمياً من التصاميم والمواصفة.
 *
 * الفحوص الحية تحتاج أداةً ووسائطها لتهاجم الخادم المقلع:
 *   - هدف التسريب: نداء بقيم دليلية يفشل upstream عنده فيظهر السر
 *     إن كانت الأداة سيئة التعقيم (HD-02).
 *   - هدف الاجتياز: حمولة ../../ يجب أن تصل upstream مرمزةً (HD-03).
 *
 * الاختيار: أول أداة نقطة أساسها تحمل معامل مسار؛ وإلا أول أداة
 * بمعامل نصي. لا يوجد مرشح؟ تُلغى الفحوص الحية لهذا التشغيل
 * ويوثق ذلك صراحة في ملخص المرحلة (لا إخفاء صامت).
 */

import type { AnalyzedSpec, ToolDesign } from "@agentbridge/shared";
import { TRAVERSAL_MARKER, type ProbeTarget } from "@agentbridge/hardening";

export interface DerivedProbeTargets {
  readonly leakTarget: ProbeTarget;
  readonly traversalTarget: ProbeTarget & { readonly expectEncoded: string };
}

/** قيمة دليلية آمنة بحسب نوع المعامل */
function dummyValue(type: "string" | "number" | "boolean", payload?: string): string | number | boolean {
  if (type === "number") return 1;
  if (type === "boolean") return true;
  return payload ?? "probe";
}

/** يملأ كل معاملات الأداة بقيم دليلية، مع إعطاء معامل واحد قيمة خاصة */
function fillArgs(design: ToolDesign, specialParam: string | null, payload: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(design.parameters)) {
    args[name] =
      name === specialParam ? payload : dummyValue(spec.type);
  }
  return args;
}

export function deriveProbeTargets(
  designs: readonly ToolDesign[],
  analyzed: AnalyzedSpec,
): DerivedProbeTargets | undefined {
  // الأولوية: أداة نقطة أساسها فيه معامل مسار — مثالية للفحصين معاً
  const candidate =
    designs.find((design) => {
      const endpoint = analyzed.spec.endpoints.find(
        (item) => item.operationId === design.endpointIds[0],
      );
      return (endpoint?.pathParams.length ?? 0) > 0;
    }) ?? designs[0];
  if (candidate === undefined) return undefined;

  const endpoint = analyzed.spec.endpoints.find((item) => item.operationId === candidate.endpointIds[0]);
  const pathParam = endpoint?.pathParams[0];
  const stringParam = Object.entries(candidate.parameters).find(([, spec]) => spec.type === "string")?.[0];
  const targetParam = pathParam ?? stringParam;
  if (targetParam === undefined || !Object.hasOwn(candidate.parameters, targetParam)) {
    return undefined;
  }

  const traversalPayload = `../../${TRAVERSAL_MARKER}`;
  return {
    leakTarget: {
      name: candidate.name,
      args: fillArgs(candidate, null, ""),
    },
    traversalTarget: {
      name: candidate.name,
      args: fillArgs(candidate, targetParam, traversalPayload),
      expectEncoded: `..%2F..%2F${TRAVERSAL_MARKER}`,
    },
  };
}
