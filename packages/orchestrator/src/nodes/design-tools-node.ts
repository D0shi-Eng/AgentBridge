/**
 * عقدة design_tools — أول عقدة وكيلية في الرسم (وثيقة 09).
 *
 * تستدعي DesignerAgent بحلقه الداخلية (3 دورات ببواباتها)؛
 * استنفاد الدورات يصل هنا بعد أن أجرى الوكيل إصلاحه الذاتي،
 * فلا retry أعمى ولا إصلاح مكرر — قرار المنسق: توقف وتصعيد بشري.
 */

import { DesignerAgent } from "@agentbridge/agents";
import type { LlmProvider } from "@agentbridge/llm";
import { Errors, type AppError } from "@agentbridge/shared";
import type { NodeOutcome, PipelineNode } from "../graph.js";
import { isTransientError } from "../retry-policy.js";
import type { PipelineContext } from "../context-store.js";

export function createDesignToolsNode(context: PipelineContext, provider: LlmProvider, flywheel?: import("../contracts.js").FlywheelStore): PipelineNode {
  return {
    stage: "design_tools",
    kind: "agent",
    async run(): Promise<NodeOutcome> {
      const analyzed = context.data.analyzed;
      if (analyzed === undefined) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.internal("design_tools قبل analyze — تسلسل الرسم مكسور"),
        };
      }
      const designed = await new DesignerAgent(provider, flywheel).designTools({
        analyzed,
        tenantId: context.tenantId,
      });
      if (!designed.ok) {
        // خطأ عابر (شبكة) يعاد؛ استنفاد الدورات الذاتية = تصعيد فوري
        return { kind: "failed", fatal: !isTransientError(designed.error), error: designed.error };
      }
      context.data.designs = [...designed.value.designs];
      return {
        kind: "completed",
        summary: `صُممت ${designed.value.designs.length} أدوات في ${designed.value.roundsUsed} دورة`,
        code: "design.completed",
        params: { tools: designed.value.designs.length, rounds: designed.value.roundsUsed },
      };
    },
  };
}

/** تصدير داخلي لفحص العُبور — يستخدمه المحرك أيضاً في قرار الفشل */
export function describeFatal(error: AppError): boolean {
  return !isTransientError(error);
}
