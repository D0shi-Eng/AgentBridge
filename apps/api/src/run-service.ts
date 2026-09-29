/**
 * خدمة التشغيل — الجسر بين HTTP والمنسق: يبدأ ويستأنف وينهي التشغيلات.
 *
 * مسؤولياته حصراً:
 *   1. تجميع خيارات PipelineOrchestrator (مزود، workDir مؤقت مُدار، snapshot فوق L1).
 *   2. ترحيل كل حدث أنبوب إلى L1 وسجل التدقيق ومشتركي البث.
 *   3. عند الانتهاء: تفويض الحفظ للمساعدين ثم مسح workDir.
 * لا منطق مراحل هنا — القرارات كلها في المنسق (فصل المسؤوليات).
 * المساعدون (artifact-helpers/provider-factory/pipeline-executor/hitl-handler) منعزلون لبقاء هذا الملف ≤200.
 */

import { EventEmitter } from "node:events";
import { AppError, type PipelineEvent } from "@agentbridge/shared";
import { redactText } from "@agentbridge/infra";
import { LiveNdjsonStream, type EventStreamSource } from "./event-stream.js";
import type { RunHandle, RunServiceDeps, StartOptions } from "./run-service-contracts.js";
import { sanitizePipelineEvent } from "./run-service/event-sanitizer.js";
import { persistRunResult } from "./run-service/artifact-helpers.js";
import { executePipeline, saveFlywheelLesson } from "./run-service/pipeline-executor.js";

export { createStandardProviderFactory } from "./run-service/provider-factory.js";

export class RunService {
  private readonly handles = new Map<string, RunHandle>();

  constructor(private readonly deps: RunServiceDeps) {}

  isRunning(runId: string): boolean {
    const handle = this.handles.get(runId);
    return handle !== undefined && !handle.done;
  }

  /** عدد التشغيلات الجارية لمستأجر واحد — سقف العمليات المكلفة */
  activeCountFor(tenantId: string): number {
    let count = 0;
    for (const handle of this.handles.values()) {
      if (!handle.done && handle.tenantId === tenantId) count += 1;
    }
    return count;
  }

  /**
   * عدد المقود المحتفظ بها كلياً (جارية + مكتملة
   * قبل تقاعدها) — مقياس دورة الحياة للاختبار والمراقبة: بعد التقاعد
   * يعود إلى ما كان عليه قبل التشغيل فلا نمو بلا حد.
   */
  handleCount(): number {
    return this.handles.size;
  }

  /** مدة تقاعد المقود المكتمل — سياسة معلنة (0 = حذف فوري بعد انقضاء المشتركين) */
  private get retentionMs(): number {
    return this.deps.handleRetentionMs ?? 60_000;
  }

  /**
   * تقاعد المقود المكتمل — يحذفه من الخريطة
   * ويفكك مستمعيه فلا تراكم في الذاكرة عبر عمر العملية. unref كي لا
   * يعيق مؤقّت التقاعد إغلاق العملية.
   */
  private scheduleRetirement(runId: string, handle: RunHandle): void {
    handle.retireTimer = setTimeout(() => {
      this.handles.delete(runId);
    }, this.retentionMs);
    handle.retireTimer.unref();
  }

  /**
   * إغلاق منظم — يمسح كل المؤقتات والمقود
   * والمستمعين (عند إيقاف الحاوية) فلا يبقى مؤقّت يمنع الخروج ولا
   * مقود يتيم بعد موت الخدمة.
   */
  shutdown(): void {
    for (const [runId, handle] of this.handles) {
      if (handle.renewalTimer !== undefined) clearInterval(handle.renewalTimer);
      if (handle.retireTimer !== undefined) clearTimeout(handle.retireTimer);
      handle.emitter.removeAllListeners();
      this.handles.delete(runId);
    }
  }

  /** يشغل أو يستأنف دون انتظار النهاية — نمط 202 */
  start(options: StartOptions): void {
    if (this.isRunning(options.runId)) {
      throw new AppError("RUN_ALREADY_ACTIVE", "التشغيل جارٍ بالفعل ولا يقبل إعادة إطلاق");
    }
    const handle: RunHandle = { emitter: new EventEmitter(), tenantId: options.tenantId, done: false, promise: null };
    this.handles.set(options.runId, handle);
    // إيجار مولّاً مسبقاً من resume() (قرار 409 صريح هناك)
    if (options.preAcquiredLease !== undefined) {
      handle.lease = options.preAcquiredLease;
      this.beginRenewal(options.runId, handle);
      this.driveLocked(options, handle);
      return;
    }
    // بلا إيجار مسبق: إن وُجد قفل فالتولي هنا قبل أي تنفيذ — الفشل ينهي
    // المقود قبل انطلاقه (لا تنفيذ مزدوج حتى لو خسر المتسابق)
    if (this.deps.runLock !== undefined) {
      void this.deps.runLock.acquire(options.runId, this.deps.leaseTtlMs ?? 60_000)
        .then((outcome) => {
          if (!outcome.acquired) {
            this.deps.logger?.warn({ code: "RUN_LOCK_HELD", runId: options.runId }, "قفل التشغيل محتجز — المقود لم ينطلق");
            handle.done = true;
            handle.emitter.emit("done");
            // المقود الراسب يتقاعد كذلك — لا يبقى في الخريطة أبداً
            this.scheduleRetirement(options.runId, handle);
            return;
          }
          handle.lease = { ownerToken: outcome.ownerToken, fence: outcome.fence };
          this.beginRenewal(options.runId, handle);
          this.driveLocked(options, handle);
        })
        .catch((error: unknown) => {
          this.deps.logger?.error({ err: error }, "فشل تولي إيجار التشغيل");
          handle.done = true;
          handle.emitter.emit("done");
          this.scheduleRetirement(options.runId, handle);
        });
      return;
    }
    this.driveLocked(options, handle);
  }

  /** إطلاق drive بعد تأمين الإيجار (أو بلا قفل في وضع عملية واحدة الموثق) */
  private driveLocked(options: StartOptions, handle: RunHandle): void {
    handle.promise = this.drive(options, handle).catch((error: unknown) => {
      this.deps.logger?.error({ err: error }, "انتهى تشغيل بخطأ غير متوقع");
      handle.done = true;
      handle.emitter.emit("done");
    });
  }

  /** تجديد دوري للإيجار — فشله يعلّم فقد الإيجار فتُرفض كل كتابات لاحقة */
  private beginRenewal(runId: string, handle: RunHandle): void {
    const ttl = this.deps.leaseTtlMs ?? 60_000;
    // المؤقت محفوظ على المقود — يُمسح صراحةً عند الانتهاء/الإغلاق
    handle.renewalTimer = setInterval(() => {
      if (handle.done || handle.lease === undefined) {
        clearInterval(handle.renewalTimer);
        return;
      }
      void this.deps.runLock?.renew(runId, handle.lease.ownerToken, ttl).then((renewed) => {
        if (!renewed) {
          // فقد الإيجار: worker قديم — إيقاف الكتابات فوراً (fencing في الأرشفة)
          handle.leaseLost = true;
          clearInterval(handle.renewalTimer);
          this.deps.logger?.warn({ code: "RUN_LEASE_LOST", runId }, "فقد تشغيل إيجاره — كتباته اللاحقة مرفوضة");
        }
      }).catch(() => undefined);
    }, Math.max(1000, Math.floor(ttl / 3)));
  }

  /** تحرير الإيجار في نهاية التشغيل نجاحاً أم فشلاً */
  private releaseLease(runId: string, handle: RunHandle): void {
    if (handle.lease !== undefined && this.deps.runLock !== undefined) {
      void this.deps.runLock.release(runId, handle.lease.ownerToken).catch(() => undefined);
    }
  }

  /** مصدر بث أحداث تشغيل — null إن لم يعرف المستأجر هذا التشغيل أصلاً */
  async openEventStream(tenantId: string, runId: string): Promise<LiveNdjsonStream | null> {
    const source = await this.openEventSource(tenantId, runId);
    if (source === null) return null;
    return new LiveNdjsonStream(source);
  }

  /** مصدر خام للأحداث — يشاركه NDJSON وSSE حتى لا يتضاعف المنطق */
  async openEventSource(tenantId: string, runId: string): Promise<EventStreamSource | null> {
    const record = await this.deps.semantic.getPipeline(tenantId, runId);
    if (record === null) return null;
    return this.buildSource(tenantId, runId);
  }

  private async buildSource(tenantId: string, runId: string): Promise<EventStreamSource> {
    const replayed = await this.deps.episodic.readEvents(tenantId, runId);
    const handle = this.handles.get(runId);
    if (handle === undefined) {
      return { replayed, subscribe: (handlers) => { handlers.onDone(); return () => undefined; } };
    }
    return {
      replayed,
      subscribe: (handlers) => {
        const onEvent = (event: PipelineEvent): void => handlers.onEvent(event);
        const onDone = (): void => handlers.onDone();
        handle.emitter.on("event", onEvent);
        handle.emitter.once("done", onDone);
        if (handle.done) onDone();
        return () => { handle.emitter.off("event", onEvent); handle.emitter.off("done", onDone); };
      },
    };
  }

  /** يستأنف من آخر snapshot في L1 — نقطة الدخول لمسار POST resume */
  async resume(tenantId: string, runId: string): Promise<void> {
    if (this.isRunning(runId)) throw new AppError("RUN_ALREADY_ACTIVE", "التشغيل جارٍ بالفعل ولا يقبل استئنافاً موازياً");
    const record = await this.deps.semantic.getPipeline(tenantId, runId);
    if (record === null) throw new AppError("NOT_FOUND", "التشغيل غير موجود");
    // L1 أولاً؛ بعد انتهاء TTL يرجع الأرشيف الدائم L2
    let snapshot = await this.deps.episodic.loadSnapshot(tenantId, runId);
    if (snapshot === null && this.deps.runArchive !== undefined) {
      const archived = await this.deps.runArchive.latest(tenantId, runId);
      if (archived !== null) snapshot = archived.snapshotJson;
    }
    if (snapshot === null) throw new AppError("NO_SNAPSHOT", "لا توجد نقطة استئناف محفوظة لهذا التشغيل");
    const spec = await this.deps.semantic.getSpec(tenantId, record.specId);
    if (spec === null) throw new AppError("NOT_FOUND", "مواصفة التشغيل الأصلية غير موجودة");
    // قرار الـ409 عبر العمليات يحسم **قبل** الإطلاق
    let preAcquiredLease: { ownerToken: string; fence: number } | undefined;
    if (this.deps.runLock !== undefined) {
      const outcome = await this.deps.runLock.acquire(runId, this.deps.leaseTtlMs ?? 60_000);
      if (!outcome.acquired) throw new AppError("RUN_ALREADY_ACTIVE", "قفل الاستئناف محتجز بعملية أخرى — لا استئناف موازٍ");
      preAcquiredLease = { ownerToken: outcome.ownerToken, fence: outcome.fence };
    }
    this.start({ runId, tenantId, projectId: record.projectId, specId: record.specId, rawSpec: spec.content, resumeSnapshot: snapshot, ...(preAcquiredLease !== undefined ? { preAcquiredLease } : {}) });
  }

  private async drive(options: StartOptions, handle: RunHandle): Promise<void> {
    try {
      const onEvent = (event: PipelineEvent): void => this.relayEvent(handle, event);
      const summary = await executePipeline(this.deps, options, onEvent, handle);
      await persistRunResult(this.deps, options, summary);
      await saveFlywheelLesson(this.deps, options, summary);
    } finally {
      // تحرير الإيجار دائماً — نجاحاً أم فشلاً
      // مسح مؤقت التجديد فوراً + جدولة تقاعد المقود — لا مؤقت
      // يتيم ولا نمو خريطة بلا حد في العمليات طويلة العمر
      if (handle.renewalTimer !== undefined) clearInterval(handle.renewalTimer);
      this.releaseLease(options.runId, handle);
      handle.done = true;
      handle.emitter.emit("done");
      this.scheduleRetirement(options.runId, handle);
    }
  }

  /** يرحّل حدثاً واحداً إلى L1 والتدقيق والمشتركين — onEvent المنسق.
   * كل حدث يمر بالمعقم أولاً — allowlist الحقول + حجب الأسرار
   * في الملخص — فلا بث ولا تخزين لحد يحمل حقولاً غير معلنة. */
  private relayEvent(handle: RunHandle, event: PipelineEvent): void {
    const sanitized = sanitizePipelineEvent(event);
    if (sanitized === null) {
      this.deps.logger?.warn({ code: "EVENT_SANITIZER_DROPPED", runId: event.runId, stage: event.stage }, "سقط حدث لا يطابق المخطط — لم يُبث ولم يُخزن");
      return;
    }
    void this.deps.episodic.appendEvent(sanitized.tenantId, sanitized.runId, sanitized)
      .then(() => this.deps.audit.record({ tenantId: sanitized.tenantId, runId: sanitized.runId, stage: sanitized.stage, decision: sanitized.stageStatus ?? "event", abstractedPayload: redactText(sanitized.summary), at: sanitized.at }))
      .catch(() => this.deps.logger?.warn({ code: "AUDIT_RELAY_FAILED" }, "تعذر ترحيل حدث إلى L1 أو سجل التدقيق"));
    handle.emitter.emit("event", sanitized);
  }
}