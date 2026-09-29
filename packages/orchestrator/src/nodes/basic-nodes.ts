/**
 * العقد الحتمية الثلاث الأولى: load_spec ← normalize ← analyze.
 *
 * لا LLM هنا إطلاقاً (القاعدة 17: الحتمي أولاً). كل عقدة تقرأ مدخلاتها
 * من السياق حصراً وتكتب مخرجها فيه — وهذا جوهر الidempotency والاستئناف.
 */

import { Errors } from "@agentbridge/shared";
import { parseOpenApiSpec } from "@agentbridge/spec-parser";
import { analyzeSpec } from "@agentbridge/analyzer";
import type { NodeOutcome, PipelineNode } from "../graph.js";
import type { PipelineContext } from "../context-store.js";

/** مدخل التشغيل كله: نص المواصفة الخام (من ملف/رفع/واجهة لاحقاً) */
export interface LoadSpecInput {
  readonly rawSpec: string;
}

/** load_spec: يستقبل النص الخام ويحفظه في السياق */
export function createLoadSpecNode(context: PipelineContext, input: LoadSpecInput): PipelineNode {
  return {
    stage: "load_spec",
    kind: "deterministic",
    async run(): Promise<NodeOutcome> {
      if (input.rawSpec.trim().length === 0) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.invalidInput("نص المواصفة فارغ — لا يمكن تشغيل الأنبوب بلا مواصفة"),
        };
      }
      context.data.rawSpec = input.rawSpec;
      return { kind: "completed", summary: `استُقبلت المواصفة (${input.rawSpec.length} بايت)`, code: "spec.received", params: { bytes: input.rawSpec.length } };
    },
  };
}

/** normalize: الاستيعاب والتطبيع الكامل عبر spec-parser */
export function createNormalizeNode(context: PipelineContext): PipelineNode {
  return {
    stage: "normalize",
    kind: "deterministic",
    async run(): Promise<NodeOutcome> {
      const raw = context.data.rawSpec;
      if (raw === undefined) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.internal("normalize قبل load_spec — تسلسل الرسم مكسور"),
        };
      }
      const parsed = parseOpenApiSpec(raw);
      if (!parsed.ok) return { kind: "failed", fatal: true, error: parsed.error };
      context.data.normalized = parsed.value;
      return {
        kind: "completed",
        summary: `طُبّعت المواصفة «${parsed.value.title}» بعدد ${parsed.value.endpointCount} نقاط نهاية`,
        code: "spec.normalized",
        params: { endpoints: parsed.value.endpointCount },
      };
    },
  };
}

/** analyze: التحليلات الأربعة الحتمية فوق المواصفة المطبّعة */
export function createAnalyzeNode(context: PipelineContext): PipelineNode {
  return {
    stage: "analyze",
    kind: "deterministic",
    async run(): Promise<NodeOutcome> {
      const normalized = context.data.normalized;
      if (normalized === undefined) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.internal("analyze قبل normalize — تسلسل الرسم مكسور"),
        };
      }
      const analyzed = analyzeSpec(normalized);
      context.data.analyzed = analyzed;
      return {
        kind: "completed",
        summary: `حُلّلت ${analyzed.spec.endpoints.length} نقاط ورُشحت ${analyzed.mcpWorthyIds.length} كأدوات MCP محتملة`,
        code: "analyze.completed",
        params: { endpoints: analyzed.spec.endpoints.length, candidates: analyzed.mcpWorthyIds.length },
      };
    },
  };
}
