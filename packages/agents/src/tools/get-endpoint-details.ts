/**
 * أداة get_endpoint_details — إرجاع نقطة نهاية واحدة بكامل تفاصيلها
 * من التحليل الحتمي: الحقول، التصنيف، الخطورة، أنواع PII، الجدوى (وثيقة 05).
 *
 * هذه هي بوابة التأسيس (Grounding) البوابة 1: ما لا يعده النموذج من هنا
 * يعد بلا مصدر — وطبقة التحقق ترفضه.
 */

import { Errors, err, ok, type AnalyzedSpec, type Result } from "@agentbridge/shared";
import { z } from "zod";
import { validateToolInput, type AgentTool, type ToolContext } from "./tool-contract.js";

export const GetEndpointInputSchema = z
  .object({ operationId: z.string().min(1).max(200) })
  .strict();

const OutputSchema = z.object({
  operationId: z.string(),
  path: z.string(),
  method: z.string(),
  summary: z.string(),
  requiresAuth: z.boolean(),
  kind: z.string(),
  risk: z.string(),
  mcpWorthy: z.boolean(),
  piiTypes: z.array(z.string()),
  fields: z.array(
    z.object({
      name: z.string(),
      location: z.string(),
      openApiType: z.string(),
      required: z.boolean(),
      pointer: z.string(),
    }),
  ),
});

export type EndpointDetailsOutput = z.infer<typeof OutputSchema>;

/** خطأ معرف مجهول — رمز منظّم يتكرر كثيراً فيسجل هنا مرة واحدة */
function unknownEndpoint(operationId: string) {
  return err(
    Errors.invalidInput(`operationId غير موجود في المواصفة: ${operationId}`),
  );
}

export function createGetEndpointDetailsTool(analyzed: AnalyzedSpec): AgentTool<
  z.infer<typeof GetEndpointInputSchema>,
  EndpointDetailsOutput
> {
  return {
    name: "get_endpoint_details",
    description: "تفاصيل نقطة نهاية واحدة: حقولها وتصنيفها وخطورتها",
    inputSchema: GetEndpointInputSchema,
    outputSchema: OutputSchema,
    async execute(raw, _ctx: ToolContext): Promise<Result<EndpointDetailsOutput>> {
      const gate = validateToolInput(this.name, GetEndpointInputSchema, raw);
      if (!gate.ok) return gate;
      const input = gate.value;

      const endpoint = analyzed.spec.endpoints.find(
        (candidate) => candidate.operationId === input.operationId,
      );
      if (endpoint === undefined) return unknownEndpoint(input.operationId);

      // إصابات PII الخاصة بهذه النقطة فقط — بمطابقة بادئة مؤشر الحقول
      const fieldPointers = new Set(endpoint.fields.map((field) => field.pointer));
      const piiTypes = [
        ...new Set(
          analyzed.piiHits
            .filter((hit) => fieldPointers.has(hit.pointer))
            .map((hit) => hit.piiType),
        ),
      ];

      const output: EndpointDetailsOutput = {
        operationId: endpoint.operationId,
        path: endpoint.path,
        method: endpoint.method,
        summary: endpoint.summary,
        requiresAuth: endpoint.requiresAuth,
        kind: analyzed.kinds[endpoint.operationId] ?? "read",
        risk: analyzed.risks[endpoint.operationId] ?? "low",
        mcpWorthy: analyzed.mcpWorthyIds.includes(endpoint.operationId),
        piiTypes,
        fields: endpoint.fields.map((field) => ({ ...field })),
      };

      if (!OutputSchema.safeParse(output).success) {
        return err(Errors.internal("خرج أداة التفاصيل خالف مخططها — عيب برمجي"));
      }
      return ok(output);
    },
  };
}
