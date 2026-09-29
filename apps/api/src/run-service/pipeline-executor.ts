/**
 * مُنفّذ الأنابيب — منطق تشغيل المنسق والمعالجة المعزول عن حلقة التشغيل.
 *
 * ماهيته: فصل منطق بناء وتشغيل PipelineOrchestrator عن RunService
 * لتبقي run-service.ts ≤200 سطر.
 * وظيفته: بناء خيارات المنسق، تشغيله (run/resume)، والتعامل مع العمل المؤقت.
 * كيف: دالة نقية تستقبل التبعيات والخيارات وتعيد ملخص التشغيل.
 */

import { rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { withBudgetGuard, withBudgetReservation } from "@agentbridge/llm";
import { createFencedSnapshotSave } from "@agentbridge/memory";
import { PipelineOrchestrator, type SnapshotStore, type RunSummary } from "@agentbridge/orchestrator";
import type { PipelineEvent, TenantContext } from "@agentbridge/shared";
import type { RunHandle, RunServiceDeps, StartOptions } from "../run-service-contracts.js";

/**
 * يبني محول snapshot للمخزن العرضي.
 * حضور الأرشفة يجعل كل كتابة **مسورة**: لا حفظ بلا fence
 * حي ولا جيل تصاعدي — كتابة مالك قديم ترفض ولا تصل L1 أصلاً.
 */
export function createSnapshotAdapter(deps: RunServiceDeps, tenantId: string, handle?: RunHandle): SnapshotStore {
  if (deps.runArchive === undefined || handle === undefined) {
    return {
      save: (runId, json) => deps.episodic.saveSnapshot(tenantId, runId, json),
      load: (runId) => deps.episodic.loadSnapshot(tenantId, runId),
    };
  }
  return {
    save: (runId, json) => {
      const fencedSave = createFencedSnapshotSave({
        archive: deps.runArchive as typeof deps.runArchive,
        tenantId,
        runId,
        fenceOf: () => handle.lease?.fence ?? 0,
        leaseAlive: () => handle.leaseLost !== true && handle.done !== true,
      });
      // الجيل من داخل المظروف الموقّع — تصاعدي بكل حفظ
      return fencedSave(json, extractGeneration(json)).then(() => deps.episodic.saveSnapshot(tenantId, runId, json));
    },
    load: (runId) => deps.episodic.loadSnapshot(tenantId, runId),
  };
}

/** يستخرج facts.generation من مظروف snapshot الموقّع — 0 للصيغ غير الموقعة */
function extractGeneration(snapshotJson: string): number {
  try {
    const parsed = JSON.parse(snapshotJson) as { facts?: { generation?: number } };
    return typeof parsed.facts?.generation === "number" ? parsed.facts.generation : 0;
  } catch {
    return 0;
  }
}

/** يشغل المنسق ويُعيد الملخص — يعالج workDir والتأخير الذاتي */
export async function executePipeline(
  deps: RunServiceDeps,
  options: StartOptions,
  onEvent: (event: PipelineEvent) => void,
  handle?: RunHandle,
): Promise<RunSummary> {
  const workDir = join(deps.workRoot, options.runId);
  try {
    const orchestrator = new PipelineOrchestrator({
      runId: options.runId,
      tenantId: options.tenantId,
      rawSpec: options.rawSpec,
      provider: deps.budget !== undefined
        ? budgetWrappedProvider(deps, options)
        : deps.providerFactory(),
      harden: {
        workDir: join(workDir, "generated-server"),
        // المصدر إعداد الخادم عبر deps، مع تجاوز صريح لكل تشغيل
        // في الاختبارات. الافتراضي false مقصود (fail-closed): بلا فئات حية
        // لا تمنح شهادة. التشغيل على المضيف مقيد ببيئة موثوقة، ووضع
        // sandbox يعزل إقلاع الخادم المولد داخل حاوية بدلاً من المضيف.
        liveProbes: options.liveProbes ?? deps.liveProbes ?? false,
        // وضع sandbox يمنع أي إقلاع للخادم المولد على المضيف
        ...(deps.sandboxProbes === true ? { sandbox: true } : {}),
      },
      store: createSnapshotAdapter(deps, options.tenantId, handle),
      // مادة توقيع snapshots الثابتة من إعداد الخادم + حلقة تحقق
      // الدوران — غيابهما (تطوير) يبقي السلوك العابر الموثق كما هو
      ...(deps.snapshotSigning !== undefined ? { snapshotSigning: deps.snapshotSigning } : {}),
      ...(deps.snapshotVerifyKeys !== undefined ? { snapshotVerifyKeys: deps.snapshotVerifyKeys } : {}),
      ...(deps.certificateSigning !== undefined ? { certificateSigning: deps.certificateSigning } : {}),
      ...(deps.snapshotTtlMs !== undefined ? { snapshotTtlMs: deps.snapshotTtlMs } : {}),
      onEvent,
      ...(deps.flywheel !== undefined ? { flywheel: deps.flywheel } : {}),
    });
    if (options.suspendAfter !== undefined) orchestrator.withSuspensionAfter(options.suspendAfter);
    return options.resumeSnapshot !== undefined
      ? await orchestrator.resume(options.resumeSnapshot)
      : await orchestrator.run();
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * يلفط المزود بدرع الميزانية. حين توفر الحاوية دفتر حجوزات
 * ذري فالحجز الذري هو المسار (reserve→settle)؛ وإلا يبقى الدرع القائم
 * (وضع mock صفر التكلفة) — الفرق معلن لا مخفي. الحقلان في العقد النوعي
 * نفسه (BudgetShield) — لا صب مجهول يخفي العقد.
 */
function budgetWrappedProvider(deps: RunServiceDeps, options: StartOptions) {
  const budget = deps.budget;
  if (budget === undefined) return deps.providerFactory();
  const provider = deps.providerFactory();
  if (budget.reservationLedger !== undefined && budget.ceilingUsdOf !== undefined) {
    return withBudgetReservation(provider, {
      tenantId: options.tenantId,
      ledger: budget.reservationLedger,
      // مفتاح حتمي من محتوى الطلب — retry نفس الطلب يعيد استخدام الحجز
      idempotencyKeyOf: (request) => createHash("sha256").update(request.system + JSON.stringify(request.messages)).digest("hex").slice(0, 32),
      ceilingUsdOf: budget.ceilingUsdOf,
      ...(budget.estimateCostUsd !== undefined ? { actualCostUsdOf: budget.estimateCostUsd } : {}),
    });
  }
  return withBudgetGuard(provider, {
    tenantId: options.tenantId,
    monthlyBudgetUsd: budget.monthlyBudgetUsd,
    ledger: budget.ledger,
    ...(budget.estimateCostUsd !== undefined ? { estimateCostUsd: budget.estimateCostUsd } : {}),
  });
}

/** يحفظ درس Flywheel بعد التشغيل — نجاح/فشل يُغذي L2+L3 */
export async function saveFlywheelLesson(
  deps: RunServiceDeps,
  options: StartOptions,
  summary: RunSummary,
): Promise<void> {
  if (deps.flywheel === undefined) return;
  try {
    const specHash = createHash("sha256").update(options.rawSpec).digest("hex").slice(0, 32);
    const granted = summary.certificate?.granted ?? false;
    const score = summary.certificate?.finalScore ?? 0;
    const context: TenantContext = { tenantId: options.tenantId, principal: { actorType: "service", authMethod: "api_key", subjectId: "internal:pipeline", credentialId: "internal:pipeline", tenantId: options.tenantId, permissions: ["flywheel:write"], authorizationVersion: 1 } };
    await deps.flywheel.saveLesson(context, {
      specPattern: specHash,
      designDecision: summary.certificate !== undefined ? `tools:${summary.certificate.finalScore}:${summary.certificate.verificationId.slice(0, 8)}` : `status:${summary.finalStatus}`,
      outcome: granted ? "success" : "failure",
      score,
      tenantId: options.tenantId,
      createdAt: new Date().toISOString(),
    });
  } catch {
    deps.logger?.warn({ code: "FLYWHEEL_SAVE_FAILED" }, "تعذر حفظ درس Flywheel");
  }
}
