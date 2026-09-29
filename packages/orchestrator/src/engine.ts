/**
 * محرك التنسيق — يشغّل الرسم البياني بقرارات حتمية صفر LLM (وثيقة 04 §6).
 *
 * مسؤولياته فقط:
 *   1. تنفيذ المراحل بالترتيب الملزم وتسجيل كل انتقال حدثاً.
 *   2. إعادة المحاولة الزمنية للعيوب العابرة وفق جدول 09.
 *   3. حلقة الإصلاح ≤3 دورات ثم needs_human (تصعيد).
 *   4. التقاط snapshot بعد كل مرحلة مكتملة — أساس الاستئناف.
 * عقد البناء منعزلة في engine-nodes.ts لبقاء هذا الملف ≤200 سطر.
 */

import { createHash } from "node:crypto";
import type { FailureReport, StageId, StageStatus } from "@agentbridge/shared";
import { EXECUTION_ORDER, isRepairableStage } from "./graph.js";
import { PipelineContext } from "./context-store.js";
import { createEventLog, type EventLog } from "./event-log.js";
import { MAX_REPAIR_CYCLES, decideRetry, realSleep } from "./retry-policy.js";
import { createMemorySnapshotStore, type OrchestratorOptions, type RepairRuntimeLimits, type RunSummary, type SnapshotStore } from "./contracts.js";
import { createRepairNode } from "./nodes/repair-node.js";
import { buildNodes } from "./engine-nodes.js";
import { classifySnapshot, defaultProcessSigningMaterial, SNAPSHOT_POLICY_VERSION, type SnapshotKeyRing, type SnapshotSigningMaterial, type SnapshotResumeBinding } from "./snapshot-signing.js";

export class PipelineOrchestrator {
  private readonly log: EventLog;
  private suspendAfter?: StageId;
  /** مادة توقيع snapshots — الإنتاج يمرر مفتاح إعداد الخادم عبر الخيارات */
  private readonly signing: SnapshotSigningMaterial;
  /** ربط هوية الاستئناف الموقّع داخل كل snapshot */
  private readonly resumeBinding: SnapshotResumeBinding;
  /** حدود حلقة الإصلاح — الافتراضيات الموثقة في وثيقة 06 */
  private readonly repairLimits: RepairRuntimeLimits;

  constructor(private readonly options: OrchestratorOptions) {
    this.log = createEventLog(options.onEvent);
    this.signing = options.snapshotSigning ?? defaultProcessSigningMaterial();
    this.resumeBinding = options.resumeBinding ?? { allowedSubjects: [], minAuthorizationVersion: 0 };
    this.repairLimits = options.repairLimits ?? { cycleDeadlineMs: 120_000, maxCompletionChars: 240_000 };
  }

  async run(): Promise<RunSummary> {
    return this.drive(new PipelineContext(this.options.runId, this.options.tenantId));
  }

  /**
   * الاستئناف ببوابات الهوية كاملة: تصنيف → legacy يُحجر بلا قبول
   * صامت → توقيع/مفتاح/صلاحية/هوية/تخويل تتحقق قبل لمس الحالة لأي غرض.
   */
  async resume(snapshotJson: string): Promise<RunSummary> {
    if (classifySnapshot(snapshotJson) === "legacy") {
      const fresh = new PipelineContext(this.options.runId, this.options.tenantId);
      return this.failedSummary(fresh, undefined, "SNAPSHOT_LEGACY_QUARANTINED: snapshot إصدار 1 غير موقعة — لا يُقبل بصمت؛ مسار الهجرة المصدرح يتطلب authorizedBy");
    }
    // حلقة الدوران: المفتاح الحالي + مفاتيح التحقق السابقة (قراءة
    // فقط) — التحقق بأي مفتاح معروف، والإصدار يبقى بالحالي في snapshotJson
    const keyRing: SnapshotKeyRing = new Map([
      ...(this.options.snapshotVerifyKeys ?? []),
      [this.signing.keyId, this.signing.publicKey],
    ]);
    const restored = PipelineContext.fromSignedSnapshot(snapshotJson, keyRing, {
      runId: this.options.runId,
      tenantId: this.options.tenantId,
      ...(this.options.resumer?.subjectId !== undefined ? { resumerSubject: this.options.resumer.subjectId } : {}),
      ...(this.options.resumer?.authorizationVersion !== undefined ? { authorizationVersion: this.options.resumer.authorizationVersion } : {}),
      policyVersion: SNAPSHOT_POLICY_VERSION,
    });
    if (!restored.ok) {
      const fresh = new PipelineContext(this.options.runId, this.options.tenantId);
      return this.failedSummary(fresh, undefined, `${restored.error.code}: ${restored.error.message}`);
    }
    return this.drive(restored.value);
  }

  withSuspensionAfter(stage: StageId): this {
    this.suspendAfter = stage;
    return this;
  }

  /** نص snapshot الموقّع بجيله التصاعدي — نقطة التخزين الوحيدة */
  private snapshotJson(context: PipelineContext): string {
    return context.toSignedSnapshot({
      material: this.signing,
      resumeBinding: this.resumeBinding,
      inputDigests: { rawSpecSha256: createHash("sha256").update(this.options.rawSpec).digest("hex"), ...(this.options.inputDigests ?? {}) },
      // الصلاحية من سياسة الاحتفاظ الممررة بلا تمديد صامت
      ...(this.options.snapshotTtlMs !== undefined ? { ttlMs: this.options.snapshotTtlMs } : {}),
    });
  }

  private async drive(context: PipelineContext): Promise<RunSummary> {
    const store = this.options.store ?? createMemorySnapshotStore();
    const sleep = this.options.sleep ?? realSleep;
    const nodes = buildNodes(context, this.options);

    for (const stage of EXECUTION_ORDER) {
      if (context.statuses.get(stage) === "completed") continue;
      const node = nodes.get(stage);
      if (node === undefined) return this.failedSummary(context, stage, "عقدة مرحلة غير معرفة — عيب تجميع");

      let transientAttempt = 0;
      stageLoop: while (true) {
        context.setStatus(stage, "running");
        this.event(context, stage, `انطلقت المرحلة ${stage}`, "running", "stage.started");
        const outcome = await node.run();

        if (outcome.kind === "completed") {
          context.setStatus(stage, "completed");
          // كود العقدة ومعاملاتها يمران حدثاً مترجماً — الملخص للسجلات
          this.event(context, stage, outcome.summary, "completed", outcome.code, outcome.params);
          await store.save(context.runId, this.snapshotJson(context));
          if (this.suspendAfter === stage) {
            this.event(context, stage, "إيقاف متحكم به للاستئناف لاحقاً", undefined, "run.suspended");
            return this.summary(context, "suspended", stage, "أُوقف بعد اكتمال هذه المرحلة بقصد");
          }
          break stageLoop;
        }

        if (outcome.kind === "needs_repair") {
          const decided = await this.handleNeedsRepair(context, stage, outcome.failure, store);
          if (decided === "rerun") { transientAttempt = 0; continue stageLoop; }
          return decided;
        }

        if (outcome.fatal) {
          context.setStatus(stage, "failed");
          this.event(context, stage, `فشل نهائي: ${outcome.error.message}`, "failed", "run.failed", { code: outcome.error.code });
          return this.failedSummary(context, stage, outcome.error.message);
        }
        transientAttempt += 1;
        const decision = decideRetry(outcome.error, transientAttempt);
        if (decision.action === "retry") {
          this.event(context, stage, `عيب عابر (${outcome.error.code}) — إعادة بعد ${decision.delayMs}ms`, undefined, "run.retrying", { code: outcome.error.code, delayMs: decision.delayMs });
          await sleep(decision.delayMs);
          continue stageLoop;
        }
        context.setStatus(stage, "failed");
        this.event(context, stage, `استُنفدت الإعادات: ${outcome.error.message}`, "failed", "run.retries_exhausted", { code: outcome.error.code });
        return this.failedSummary(context, stage, outcome.error.message);
      }
    }
    return this.summary(context, "completed", undefined, undefined);
  }

  private async handleNeedsRepair(context: PipelineContext, stage: StageId, failure: FailureReport, store: SnapshotStore): Promise<RunSummary | "rerun"> {
    if (!isRepairableStage(stage)) {
      context.setStatus(stage, "needs_human");
      this.event(context, stage, "فشل غير قابل للإصلاح بالترقيع — تصعيد بشري", "needs_human", "run.needs_human", { reason: "non_repairable" });
      return this.summary(context, "needs_human", stage, `المرحلة ${stage} لا تقبل ترقيعاً موضعياً`);
    }
    if (context.repairCyclesUsed >= MAX_REPAIR_CYCLES) {
      context.setStatus(stage, "needs_human");
      this.event(context, stage, `استُنفدت ${MAX_REPAIR_CYCLES} دورات إصلاح — تصعيد بشري`, "needs_human", "run.needs_human", { reason: "repair_cycles" });
      return this.summary(context, "needs_human", stage, "تجاوز سقف دورات الإصلاح");
    }
    context.repairCyclesUsed += 1;
    context.setStatus(stage, "needs_repair");
    this.event(context, stage, `دورة إصلاح ${context.repairCyclesUsed}/${MAX_REPAIR_CYCLES}: ${failure.summary}`, "needs_repair", "repair.cycle_started", { cycle: context.repairCyclesUsed, max: MAX_REPAIR_CYCLES });
    const repairNode = createRepairNode(context, this.options.provider, failure, this.options.flywheel, this.repairLimits);
    const repaired = await repairNode.run();
    if (repaired.kind !== "completed") {
      const message = repaired.kind === "failed" ? repaired.error.message : "نتيجة إصلاح غير متوقعة";
      context.setStatus(stage, "needs_human");
      this.event(context, stage, `فشل وكيل الإصلاح: ${message} — تصعيد بشري`, "needs_human", "run.needs_human", { reason: "repair_agent_failed" });
      return this.summary(context, "needs_human", stage, message);
    }
    this.event(context, stage, repaired.summary, undefined, repaired.code, repaired.params);
    await store.save(context.runId, this.snapshotJson(context));
    return "rerun";
  }

  /**
   * نقطة توليد الأحداث الوحيدة في المحرك — كل حدث يحمل كوداً
   * مستقراً ومعاملات منظمة (أرقام/أكواد ASCII) تعرضها الواجهة مترجمة؛
   * الملخص العربي يبقى بيانات L1/تدقيق ولا يُعرض خاماً في واجهة EN.
   */
  private event(
    context: PipelineContext,
    stage: StageId,
    summary: string,
    status?: StageStatus,
    code?: string,
    params?: Readonly<Record<string, string | number>>,
  ): void {
    this.log.append({
      runId: context.runId, tenantId: context.tenantId, stage, at: new Date().toISOString(), summary,
      ...(status !== undefined ? { stageStatus: status } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(params !== undefined ? { params } : {}),
    });
  }

  private summary(context: PipelineContext, finalStatus: RunSummary["finalStatus"], stoppedAt: StageId | undefined, reason: string | undefined): RunSummary {
    return {
      runId: context.runId, finalStatus, repairCyclesUsed: context.repairCyclesUsed,
      ...(stoppedAt !== undefined ? { stoppedAt } : {}), ...(reason !== undefined ? { reason } : {}),
      ...(context.data.certificate !== undefined ? { certificate: context.data.certificate } : {}),
      events: this.log.all(),
      // مدخل الاستئناف الوحيد: مظروف موقّع لا بصمة مجردة
      snapshot: this.snapshotJson(context),
    };
  }

  private failedSummary(context: PipelineContext, stage: StageId | undefined, reason: string): RunSummary {
    return this.summary(context, "failed", stage, reason);
  }
}
