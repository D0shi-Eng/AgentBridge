/**
 * أداة validate_tool_design — الفحص المرجعي لتصميم الأداة ضد المواصفة.
 *
 * هذه هي بوابة الحقيقة الثالثة عملياً: كل ادعاء في التصميم يجب أن يقابله
 * كيان حقيقي في التحليل الحتمي. القواعد الخمس (كلها حتمية):
 *   1. كل endpointId موجود فعلاً في المواصفة.
 *   2. كل endpointId رشحه محلل الجدوى أصلاً (لا ادعاء بقدرة غير مرشحة).
 *   3. الدمج محدود بخمسة endpoints للأداة الواحدة (حد أعلى موثق).
 *   4. كل معامل يقابل حقلاً حقيقياً في جهة الطلب (وليس حقلي الاستجابات —
 *      يُفرَّق بينهما بمؤشر JsonPointer: /responses/ مقابل requestBody/parameters).
 *   5. معاملات المسار الإلزامية للـendpoint الأساسي موجودة ومطلوبة.
 */

import type { AnalyzedSpec, ToolDesign } from "@agentbridge/shared";
import { ToolDesignSchema } from "@agentbridge/shared";
import { Errors, err, ok, type Result } from "@agentbridge/shared";
import { z } from "zod";
import { validateToolInput, type AgentTool, type ToolContext } from "./tool-contract.js";

/** الحد الأعلى لعدد endpoints المدمجة في أداة واحدة */
export const MAX_ENDPOINTS_PER_TOOL = 5;

export const ValidateDesignInputSchema = ToolDesignSchema;

const OutputSchema = z
  .object({
    valid: z.boolean(),
    violations: z.array(z.string()),
  })
  .strict();

export type ValidateDesignOutput = z.infer<typeof OutputSchema>;

/** فحص واحد نقٍ يعاد استخدامه من الوكيل ومن الاختبارات */
export function checkToolDesign(design: ToolDesign, analyzed: AnalyzedSpec): ValidateDesignOutput {
  const violations: string[] = [];
  const byId = new Map(analyzed.spec.endpoints.map((e) => [e.operationId, e]));

  // القاعدتان 1 و2: وجود المراجع وجدويتها
  for (const id of design.endpointIds) {
    const endpoint = byId.get(id);
    if (endpoint === undefined) {
      violations.push(`ENDPOINT_NOT_FOUND:${id}`);
      continue;
    }
    if (!analyzed.mcpWorthyIds.includes(id)) {
      violations.push(`ENDPOINT_NOT_MCP_WORTHY:${id}`);
    }
  }

  // القاعدة 3: سقف الدمج
  if (design.endpointIds.length > MAX_ENDPOINTS_PER_TOOL) {
    violations.push(`TOO_MANY_ENDPOINTS:${design.endpointIds.length}`);
  }

  // حقول جهة الطلب للمجموعة المرجعية (الموجودة منها فقط)
  const requestFields = new Map<string, { required: boolean; location: string }>();
  for (const id of design.endpointIds) {
    const endpoint = byId.get(id);
    if (endpoint === undefined) continue;
    for (const field of endpoint.fields) {
      const isResponseField = field.pointer.includes("/responses/");
      if (!isResponseField) requestFields.set(field.name, { required: field.required, location: field.location });
    }
  }

  // القاعدة 4: كل معامل له حقل طلب حقيقي
  for (const key of Object.keys(design.parameters)) {
    if (!requestFields.has(key)) violations.push(`UNKNOWN_PARAMETER:${key}`);
  }

  // القاعدة 5: معاملات المسار الإلزامية للأساس
  const primaryId = design.endpointIds[0];
  const primary = primaryId === undefined ? undefined : byId.get(primaryId);
  for (const pathParam of primary?.pathParams ?? []) {
    const param = design.parameters[pathParam];
    if (param === undefined || !param.required) {
      violations.push(`MISSING_PATH_PARAM:${pathParam}`);
    }
  }

  return { valid: violations.length === 0, violations };
}

export function createValidateToolDesignTool(
  analyzed: AnalyzedSpec,
): AgentTool<ToolDesign, ValidateDesignOutput> {
  return {
    name: "validate_tool_design",
    description: "فحص تصميم أداة مقابل endpoints المرتبطة: هل الادعاءات موجودة فعلاً؟",
    inputSchema: ValidateDesignInputSchema,
    outputSchema: OutputSchema,
    async execute(raw, _ctx: ToolContext): Promise<Result<ValidateDesignOutput>> {
      const gate = validateToolInput(this.name, ValidateDesignInputSchema, raw);
      if (!gate.ok) return gate;

      const result = checkToolDesign(gate.value, analyzed);
      if (!OutputSchema.safeParse(result).success) {
        return err(Errors.internal("خرج أداة التحقق خالف مخططها — عيب برمجي"));
      }
      return ok(result);
    },
  };
}
