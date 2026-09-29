/**
 * أداة search_spec — بحث نصي حتمي في المواصفة المطبّعة (وثيقة 05).
 *
 * تبحث رموز الاستعلام في operationId والمسار والملخص لكل endpoint
 * وتعيد المرشحات مع مؤشراتها. حتمية 100%: لا شبكة ولا نموذج.
 */

import { Errors, err, ok, type AnalyzedSpec, type Result } from "@agentbridge/shared";
import { z } from "zod";
import { validateToolInput, type AgentTool, type ToolContext } from "./tool-contract.js";

export const SearchSpecInputSchema = z
  .object({ query: z.string().min(2).max(100) })
  .strict();

export interface SearchMatch {
  readonly operationId: string;
  readonly path: string;
  readonly method: string;
  readonly summary: string;
}

export interface SearchSpecOutput {
  readonly matches: readonly SearchMatch[];
  readonly total: number;
}

const OutputShape = z.object({
  matches: z.array(
    z.object({
      operationId: z.string(),
      path: z.string(),
      method: z.string(),
      summary: z.string(),
    }),
  ),
  total: z.number().int().nonnegative(),
});

/** يبني الأداة فوق مواصفة محللة محددة — الأداة بلا حالة */
export function createSearchSpecTool(analyzed: AnalyzedSpec): AgentTool<
  z.infer<typeof SearchSpecInputSchema>,
  SearchSpecOutput
> {
  return {
    name: "search_spec",
    description: "بحث نصي في نقاط النهاية المطبّعة (معرف/مسار/ملخص)",
    inputSchema: SearchSpecInputSchema,
    outputSchema: OutputShape,
    async execute(raw, _ctx: ToolContext): Promise<Result<SearchSpecOutput>> {
      // بوابة العقد: رفض المدخل المخالف قبل أي منطق
      const gate = validateToolInput(this.name, SearchSpecInputSchema, raw);
      if (!gate.ok) return gate;
      const input = gate.value;

      // رموز البحث: تقسيم على الفراغات ومطابقة غير حساسة لحالة الأحرف
      const tokens = input.query.toLowerCase().split(/\s+/u).filter((t) => t.length > 0);

      const matches = analyzed.spec.endpoints
        .filter((endpoint) => {
          const haystack =
            `${endpoint.operationId} ${endpoint.path} ${endpoint.summary}`.toLowerCase();
          return tokens.every((token) => haystack.includes(token));
        })
        .map((endpoint) => ({
          operationId: endpoint.operationId,
          path: endpoint.path,
          method: endpoint.method,
          summary: endpoint.summary,
        }));

      const output: SearchSpecOutput = { matches, total: matches.length };
      if (!OutputShape.safeParse(output).success) {
        return err(Errors.internal("خرج أداة البحث خالف مخططها — عيب برمجي"));
      }
      return ok(output);
    },
  };
}
