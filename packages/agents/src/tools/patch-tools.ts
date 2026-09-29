/**
 * أدوات وكيل الإصلاح — التنفيذ الحتمي لقرارات الترقيع (وثيقة 04).
 *
 * apply_patch: يطبق ترقيعاً موضعياً على نسخة عمل من الـartifact —
 *   استبدال محتوى ملفات قائمة فقط، ممنوع إضافة أو حذف ملفات.
 * retest_scope: يعيد الفحوص الأمنية الساكنة على نسخة العمل الحالية،
 *   مع إمكانية حصر النطاق بمعرفات فحوص معينة (إعادة اختبار موضعية).
 *
 * الوكيل يقترح؛ هذه الأدوات تنفذ — القاعدة الذهبية في وثيقة 04.
 */

import type { SecurityCheckResult } from "@agentbridge/hardening";
import { runStaticChecks } from "@agentbridge/hardening";
import {
  Errors,
  err,
  ok,
  type GeneratedFile,
  type Result,
} from "@agentbridge/shared";
import { z } from "zod";
import { AgentsErrors } from "../errors.js";
import { validateToolInput, type AgentTool, type ToolContext } from "./tool-contract.js";

/** حامل نسخة العمل — الملكية للمنسق، الأداة تعدل فيه فقط عبر execute */
export interface WorkingCopy {
  files: GeneratedFile[];
}

/* ---------- apply_patch ---------- */

export const ApplyPatchInputSchema = z
  .object({
    files: z
      .array(z.object({ path: z.string().min(1), contents: z.string() }).strict())
      .min(1)
      .max(20),
  })
  .strict();

export interface ApplyPatchOutput {
  readonly appliedPaths: readonly string[];
}

const ApplyPatchOutputShape = z.object({ appliedPaths: z.array(z.string()) });

export function createApplyPatchTool(
  workingCopy: WorkingCopy,
): AgentTool<z.infer<typeof ApplyPatchInputSchema>, ApplyPatchOutput> {
  return {
    name: "apply_patch",
    description: "تطبيق تعديلات موضعية على ملفات الخادم المولد (استبدال كامل لمحتوى كل ملف مستهدف)",
    inputSchema: ApplyPatchInputSchema,
    outputSchema: ApplyPatchOutputShape,
    async execute(raw, _ctx: ToolContext): Promise<Result<ApplyPatchOutput>> {
      const gate = validateToolInput(this.name, ApplyPatchInputSchema, raw);
      if (!gate.ok) return gate;

      // الحارس: لا ملفات جديدة ولا حذف — فقط ملفات قائمة تُستبدل
      for (const file of gate.value.files) {
        const exists = workingCopy.files.some((candidate) => candidate.path === file.path);
        if (!exists) {
          return err(AgentsErrors.patchUnknownFile(file.path));
        }
      }

      for (const file of gate.value.files) {
        const index = workingCopy.files.findIndex((candidate) => candidate.path === file.path);
        const existing = workingCopy.files[index];
        if (existing !== undefined) {
          workingCopy.files[index] = { path: existing.path, contents: file.contents };
        }
      }
      const appliedPaths = gate.value.files.map((file) => file.path);
      if (!ApplyPatchOutputShape.safeParse({ appliedPaths }).success) {
        return err(Errors.internal("خرج أداة الترقيع خالف مخططها — عيب برمجي"));
      }
      return ok({ appliedPaths });
    },
  };
}

/* ---------- retest_scope ---------- */

export const RetestScopeInputSchema = z
  .object({
    /** معرفات الفحوص المراد إعادتها فقط — المصفوفة الفارغة تعيد الكل */
    checkIds: z.array(z.string().min(1)).max(30),
  })
  .strict();

export interface RetestOutput {
  readonly checks: readonly SecurityCheckResult[];
  readonly failedIds: readonly string[];
}

const RetestOutputShape = z.object({
  checks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      category: z.enum([
        "dangerous-code",
        "secrets",
        "injection",
        "schema",
        "errors",
        "env",
        "manifest",
        "live",
      ]),
      severityIfFailed: z.enum(["critical", "high", "medium", "info"]),
      passed: z.boolean(),
      location: z.string().optional(),
      detail: z.string().optional(),
    }),
  ),
  failedIds: z.array(z.string()),
});

export function createRetestScopeTool(
  workingCopy: WorkingCopy,
  toolNames: readonly string[],
): AgentTool<z.infer<typeof RetestScopeInputSchema>, RetestOutput> {
  return {
    name: "retest_scope",
    description: "إعادة الفحوص الأمنية الساكنة على نسخة العمل بعد الترقيع مع حصر نطاق اختياري",
    inputSchema: RetestScopeInputSchema,
    outputSchema: RetestOutputShape,
    async execute(raw, _ctx: ToolContext): Promise<Result<RetestOutput>> {
      const gate = validateToolInput(this.name, RetestScopeInputSchema, raw);
      if (!gate.ok) return gate;

      const all = runStaticChecks({ files: workingCopy.files, toolNames });
      const scoped =
        gate.value.checkIds.length === 0 ? all : all.filter((result) => gate.value.checkIds.includes(result.id));
      const output: RetestOutput = {
        checks: scoped,
        failedIds: scoped.filter((result) => !result.passed).map((result) => result.id),
      };
      if (!RetestOutputShape.safeParse(output).success) {
        return err(Errors.internal("خرج أداة إعادة الاختبار خالف مخططها — عيب برمجي"));
      }
      return ok(output);
    },
  };
}
