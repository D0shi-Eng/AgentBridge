/**
 * أداة run_security_suite — إعادة تنفيذ الفحوص الساكنة العشرة على الـartifact
 * الحالي بنفس محرك التحصين (وثيقة 04: أدوات المدقق).
 *
 * الفائدة: المدقق لا يثق بالتقرير الواصل وحده؛ يستطيع طلب تشغيل طازج
 * والتقاطع بينه وبين التقرير الخام قبل ترتيب النتائج.
 * حتمية 100% وتعيد Result ولا ترمي.
 */

import type { SecurityCheckResult } from "@agentbridge/hardening";
import { runStaticChecks } from "@agentbridge/hardening";
import { Errors, err, ok, type GeneratedServerArtifact, type Result } from "@agentbridge/shared";
import { z } from "zod";
import { validateToolInput, type AgentTool, type ToolContext } from "./tool-contract.js";

export const RunSuiteInputSchema = z.object({}).strict();

/** ملخص فحص واحد مختصر — يكفي المدقق دون إغراق السياق بالنصوص الكاملة */
export interface SuiteCheckSummary {
  readonly id: string;
  readonly title: string;
  readonly category: string;
  readonly passed: boolean;
  readonly location?: string;
  readonly detail?: string;
}

export interface RunSuiteOutput {
  readonly checks: readonly SuiteCheckSummary[];
  readonly totalChecks: number;
  readonly passedCount: number;
}

const RunSuiteOutputShape = z.object({
  checks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.string(),
      passed: z.boolean(),
      location: z.string().optional(),
      detail: z.string().optional(),
    }),
  ),
  totalChecks: z.number().int().nonnegative(),
  passedCount: z.number().int().nonnegative(),
});

export function createRunSecuritySuiteTool(
  artifact: GeneratedServerArtifact,
): AgentTool<z.infer<typeof RunSuiteInputSchema>, RunSuiteOutput> {
  return {
    name: "run_security_suite",
    description: "إعادة تشغيل الفحوص الأمنية الساكنة كاملة على الخادم المولد",
    inputSchema: RunSuiteInputSchema,
    outputSchema: RunSuiteOutputShape,
    async execute(raw, _ctx: ToolContext): Promise<Result<RunSuiteOutput>> {
      const gate = validateToolInput(this.name, RunSuiteInputSchema, raw);
      if (!gate.ok) return gate;

      const results: readonly SecurityCheckResult[] = runStaticChecks({
        files: artifact.files,
        toolNames: artifact.toolNames,
      });
      const checks: SuiteCheckSummary[] = results.map((result) => ({
        id: result.id,
        title: result.title,
        category: result.category,
        passed: result.passed,
        ...(result.location !== undefined ? { location: result.location } : {}),
        ...(result.detail !== undefined ? { detail: result.detail } : {}),
      }));
      const output: RunSuiteOutput = {
        checks,
        totalChecks: checks.length,
        passedCount: checks.filter((check) => check.passed).length,
      };
      if (!RunSuiteOutputShape.safeParse(output).success) {
        return err(Errors.internal("خرج أداة الحزمة الأمنية خالف مخططها — عيب برمجي"));
      }
      return ok(output);
    },
  };
}
