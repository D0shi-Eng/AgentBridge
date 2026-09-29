/**
 * أداة simulate_tool_call — استدعاء تجريبي "جاف" لأداة مصممة (وثيقة 04).
 *
 * تتحقق حتمياً أن النداء قابل للبناء من التصميم والمواصفة المطبّعة:
 * الأداة موجودة، المعاملات مطابقة بالاسم والنوع، الإلزامي مكتمل،
 * وتُبنى خطة الطلب (method/url/query/body) كما ستبنيها القوالب فعلاً.
 *
 * الحد الموثق: التنفيذ الشبكي الحي للأداة مغطى بفحوص hardening
 * الحية (HD-01..HD-04) وهي دليل البوابة 4 التنفيذي؛ هذه الأداة تثبت
 * قابلية البناء الصحيحة قبل إقلاع أي شيء.
 */

import type { AnalyzedSpec, ToolDesign } from "@agentbridge/shared";
import { Errors, err, ok, type Result } from "@agentbridge/shared";
import { z } from "zod";
import { validateToolInput, type AgentTool, type ToolContext } from "./tool-contract.js";

export const SimulateCallInputSchema = z
  .object({
    toolName: z.string().min(1),
    args: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .strict();

export interface SimulationIssue {
  readonly kind: "unknown_tool" | "unknown_parameter" | "missing_required" | "type_mismatch";
  readonly detail: string;
}

export interface SimulateCallOutput {
  readonly toolName: string;
  readonly method: string;
  /** المسار بعد تعويض معاملات المسار وترميزها */
  readonly url: string;
  readonly query: Readonly<Record<string, string>>;
  readonly bodyKeys: readonly string[];
  readonly issues: readonly SimulationIssue[];
  /** هل اكتملت الخطة دون أي إشكالية؟ */
  readonly constructible: boolean;
}

const OutputShape = z.object({
  toolName: z.string(),
  method: z.string(),
  url: z.string(),
  query: z.record(z.string(), z.string()),
  bodyKeys: z.array(z.string()),
  issues: z.array(
    z.object({ kind: z.enum(["unknown_tool", "unknown_parameter", "missing_required", "type_mismatch"]), detail: z.string() }),
  ),
  constructible: z.boolean(),
});

/** فحص نوع قيمة واحدة ضد النوع المعلن في تصميم الأداة */
function typeMatches(declared: "string" | "number" | "boolean", value: string | number | boolean): boolean {
  return typeof value === declared;
}

export function createSimulateToolCallTool(
  designs: readonly ToolDesign[],
  analyzed: AnalyzedSpec,
): AgentTool<z.infer<typeof SimulateCallInputSchema>, SimulateCallOutput> {
  return {
    name: "simulate_tool_call",
    description: "بناء خطة نداء جافة لأداة مصممة والتحقق من معاملاتها ضد المواصفة",
    inputSchema: SimulateCallInputSchema,
    outputSchema: OutputShape,
    async execute(raw, _ctx: ToolContext): Promise<Result<SimulateCallOutput>> {
      const gate = validateToolInput(this.name, SimulateCallInputSchema, raw);
      if (!gate.ok) return gate;
      const { toolName, args } = gate.value;

      const design = designs.find((candidate) => candidate.name === toolName);
      if (design === undefined) {
        return ok({
          toolName,
          method: "",
          url: "",
          query: {},
          bodyKeys: [],
          issues: [{ kind: "unknown_tool", detail: `الأداة ${toolName} غير موجودة في التصاميم` }],
          constructible: false,
        });
      }

      const primaryId = design.endpointIds[0] ?? "";
      const endpoint = analyzed.spec.endpoints.find((item) => item.operationId === primaryId);
      if (endpoint === undefined) {
        return err(Errors.internal(`endpoint الأساسي ${primaryId} غائب عن التحليل — عيب في التجميع`));
      }

      const issues: SimulationIssue[] = [];
      const knownParams = new Set(Object.keys(design.parameters));

      // معامل زائد ليس في التصميم = تخمين من المستدعي
      for (const key of Object.keys(args)) {
        if (!knownParams.has(key)) {
          issues.push({ kind: "unknown_parameter", detail: `معامل غير معلن في التصميم: ${key}` });
        }
      }

      // كل معاملات التصميم: نوع صحيح؟ إلزامي حاضر؟
      for (const [name, spec] of Object.entries(design.parameters)) {
        const value = args[name];
        if (value === undefined) {
          if (spec.required) {
            issues.push({ kind: "missing_required", detail: `معامل إلزامي غائب: ${name}` });
          }
          continue;
        }
        if (!typeMatches(spec.type, value)) {
          issues.push({
            kind: "type_mismatch",
            detail: `المعامل ${name} ينتظر ${spec.type} وجاء ${typeof value}`,
          });
        }
      }

      // بناء الخطة: مسار مرمز + استعلام + مفاتيح الجسم من حقول الطلب
      const requestFields = endpoint.fields.filter((field) => !field.pointer.includes("/responses/"));
      const url = endpoint.path.replace(/\{([^}]+)\}/gu, (_match, paramName: string) => {
        const value = args[paramName];
        return value !== undefined ? encodeURIComponent(String(value)) : `{${paramName}}`;
      });
      const query: Record<string, string> = {};
      const bodyKeys: string[] = [];
      for (const field of requestFields) {
        const value = args[field.name];
        if (value === undefined || field.location === "header" || field.location === "cookie") continue;
        if (field.location === "query") query[field.name] = String(value);
        else if (field.location === "body") bodyKeys.push(field.name);
      }

      const output: SimulateCallOutput = {
        toolName,
        method: endpoint.method.toUpperCase(),
        url,
        query,
        bodyKeys,
        issues,
        constructible: issues.length === 0,
      };
      if (!OutputShape.safeParse(output).success) {
        return err(Errors.internal("خرج أداة المحاكاة خالف مخططها — عيب برمجي"));
      }
      return ok(output);
    },
  };
}
