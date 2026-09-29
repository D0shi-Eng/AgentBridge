/**
 * عقدة generate_server — توليد artifact الخادم حتمياً من التحليل والتصاميم.
 *
 * المولد يتحقق دفاعياً من كل تصميم بنفسه (لا ثقة بمخرج الوكيل)؛
 * فشل التوليد إذن يعني عيباً بنيوياً في التصاميم نفسها —
 * لا يصلحه ترقيع ملفات، فالقرار: توقف وتصعيد (لا retry ولا repair).
 */

import { generateServer } from "@agentbridge/generator";
import { Errors } from "@agentbridge/shared";
import type { NodeOutcome, PipelineNode } from "../graph.js";
import type { PipelineContext } from "../context-store.js";

export function createGenerateServerNode(context: PipelineContext): PipelineNode {
  return {
    stage: "generate_server",
    kind: "deterministic",
    async run(): Promise<NodeOutcome> {
      const analyzed = context.data.analyzed;
      const designs = context.data.designs;
      if (analyzed === undefined || designs === undefined) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.internal("generate_server بلا تحليل أو تصاميم — تسلسل الرسم مكسور"),
        };
      }
      const generated = generateServer({ analyzed, designs });
      if (!generated.ok) {
        return { kind: "failed", fatal: true, error: generated.error };
      }
      context.data.artifact = generated.value;
      return {
        kind: "completed",
        summary: `وُلّد خادم بـ ${generated.value.toolNames.length} أدوات و${generated.value.files.length} ملفات`,
        code: "generate.completed",
        params: { tools: generated.value.toolNames.length, files: generated.value.files.length },
      };
    },
  };
}
