/**
 * عقدة repair — ليست مرحلة في الرسم؛ حلقة فرعية يستدعيها المحرك
 * عند needs_repair من harden أو evaluate (وثيقة 09: repair ≤3).
 *
 * تضيف حلقة الإصلاح هذه حدوداً مفروضة:
 *   - سياسة الحدود (repair-policy): مسارات canonical + امتدادات + سقوف حجم.
 *   - deadline الدورة: سباق زمني صريح — تجاوزه فشل تصعيد (إلغاء تعاوني
 *     موثق: وعد النداء الجاري يُهدر لا يُقتل — حد مُطبق على القرار لا على
 *     العملية الأساسية).
 *   - سقف رموز الدورة: غلاف مزود يحصي أحرف المخرجات تراكمياً ويرفض فوقه.
 *   - تحقق AST (HB-13) على ملفات .ts المتغيرة بعد التطبيق.
 *   - إبطال صريح: نجاح الترقيع يحذف الدليل الحي والشهادة السابقتين —
 *     تغير الـartifact يقتل أي اعتماد قديم.
 */

import { checkAstBoundaries } from "@agentbridge/hardening";
import { RepairerAgent, createApplyPatchTool, createRetestScopeTool, type WorkingCopy } from "@agentbridge/agents";
import { enforcePatchPolicy } from "@agentbridge/agents";
import { AppError, Errors, type FailureReport } from "@agentbridge/shared";
import type { LlmProvider } from "@agentbridge/llm";
import type { NodeOutcome } from "../graph.js";
import type { PipelineContext } from "../context-store.js";
import type { RepairRuntimeLimits } from "../contracts.js";

export interface RepairCycleResult {
  /** المسارات التي لمسها الترقيع فعلاً */
  readonly appliedPaths: readonly string[];
  /** معرفات الفحوص الساكنة التي ما زالت فاشلة بعد الترقيع */
  readonly stillFailedIds: readonly string[];
}

/** غلاف سقف الأحرف — يحصي مخرجات النموذج تراكمياً ويرفض النداء فوق السقف */
function withCharCeiling(provider: LlmProvider, maxChars: number, state: { total: number }): LlmProvider {
  return {
    name: `${provider.name}+repair-ceiling`,
    async complete(request) {
      if (state.total >= maxChars) {
        return {
          ok: false,
          error: new AppError("REPAIR_TOKEN_CEILING", `استُنفد سقف مخرجات الإصلاح (${maxChars} حرفاً) — تصعيد`, false, "warning"),
        };
      }
      const response = await provider.complete(request);
      if (response.ok) state.total += response.value.text.length;
      return response;
    },
  };
}

export function createRepairNode(
  context: PipelineContext,
  provider: LlmProvider,
  failure: FailureReport,
  flywheel?: import("../contracts.js").FlywheelStore,
  limits?: RepairRuntimeLimits,
): { stage: "repair"; kind: "agent"; run(): Promise<NodeOutcome> } & { cycleResult?: RepairCycleResult } {
  const effective: RepairRuntimeLimits = limits ?? { cycleDeadlineMs: 120_000, maxCompletionChars: 240_000 };
  const node = {
    stage: "repair" as const,
    kind: "agent" as const,
    cycleResult: undefined as RepairCycleResult | undefined,
    async run(): Promise<NodeOutcome> {
      const startedAtMs = Date.now();
      const artifact = context.data.artifact;
      if (artifact === undefined) {
        return {
          kind: "failed",
          fatal: true,
          error: Errors.internal("repair بلا artifact — تسلسل الرسم مكسور"),
        };
      }

      // نسخة عمل معزولة — الفشل في المنتصف لا يفسد الأصل
      const workingCopy: WorkingCopy = { files: artifact.files.map((file) => ({ ...file })) };

      // 1) اقتراح الترقيع تحت سقف الأحرف ثم سباق الـdeadline (إلغاء تعاوني موثق)
      const ceilingState = { total: 0 };
      const propose = new RepairerAgent(withCharCeiling(provider, effective.maxCompletionChars, ceilingState), flywheel)
        .proposeRepair({
          failure: { ...failure, attempt: context.repairCyclesUsed },
          currentFiles: workingCopy.files,
          tenantId: context.tenantId,
        });
      const proposed = await raceWithDeadline(propose, effective.cycleDeadlineMs, startedAtMs);
      if (!proposed.ok) return { kind: "failed", fatal: false, error: proposed.error };

      // 2) سياسة الحدود قبل التطبيق — مسارات/امتدادات/سقوف
      const policyGate = enforcePatchPolicy(proposed.value, workingCopy.files);
      if (!policyGate.ok) return { kind: "failed", fatal: false, error: policyGate.error };

      // 3) التطبيق الحتمي على نسخة العمل
      const patcher = createApplyPatchTool(workingCopy);
      const applied = await patcher.execute({ files: proposed.value.files.map((f) => ({ ...f })) }, {
        tenantId: context.tenantId,
      });
      if (!applied.ok) return { kind: "failed", fatal: true, error: applied.error };

      // 4) تحقق AST على ملفات .ts المتغيرة — لا ترقيع يكسر حدود الاستيراد/النداء
      const changedTs = new Map<string, string>();
      for (const file of proposed.value.files) {
        if (file.path.endsWith(".ts")) changedTs.set(file.path, file.contents);
      }
      if (changedTs.size > 0) {
        const ast = checkAstBoundaries(changedTs);
        if (!ast.passed) {
          return {
            kind: "failed",
            fatal: false,
            error: new AppError("REPAIR_AST_BOUNDARY", `ترقيع كسر حدود AST: ${ast.detail ?? ast.id} — رُفض قبل الاعتماد`, false, "warning"),
          };
        }
      }

      // 5) إعادة فحص أولية على الساكنة فقط
      const tester = createRetestScopeTool(workingCopy, artifact.toolNames);
      const retested = await tester.execute({ checkIds: [] }, { tenantId: context.tenantId });
      if (!retested.ok) return { kind: "failed", fatal: true, error: retested.error };

      // 6) اعتماد نسخة العمل + إبطال صريح لكل اعتماد سابق مرتبط بالـartifact القديم
      context.data.artifact = { ...artifact, files: workingCopy.files };
      delete (context.data as { liveProbeEvidence?: unknown }).liveProbeEvidence;
      delete (context.data as { certificate?: unknown }).certificate;
      node.cycleResult = {
        appliedPaths: applied.value.appliedPaths,
        stillFailedIds: retested.value.failedIds,
      };
      return {
        kind: "completed",
        summary: `رُقّعت ${applied.value.appliedPaths.length} ملفات وبقي ${retested.value.failedIds.length} فشلاً ساكناً — أُبطل الدليل الحي والشهادة السابقتين لتغير الـartifact`,
        code: "repair.completed",
        params: { files: applied.value.appliedPaths.length, remaining: retested.value.failedIds.length },
      };
    },
  };
  return node;
}

/** سباق مع deadline — الفائز بالزمن يرفض برمز موحد (إلغاء تعاوني موثق) */
async function raceWithDeadline<T>(promise: Promise<T>, deadlineMs: number, startedAtMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    const remaining = Math.max(0, deadlineMs - (Date.now() - startedAtMs));
    timer = setTimeout(() => reject(new AppError("REPAIR_DEADLINE_EXCEEDED", `تجاوزت دورة الإصلاح مهلة ${deadlineMs}ms — تصعيد`, false, "warning")), remaining);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
