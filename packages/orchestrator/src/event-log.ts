/**
 * سجل الأحداث — كل انتقال مرحلة يُسجل حدثاً (وثيقة 09 §الأحداث).
 *
 * الأحداث تُلحق ترتيبياً وتُبث للمشتركين (CLI/اللوحة لاحقاً) لحظة وقوعها.
 * التخزين حالياً داخل الذاكرة؛ والترحيل لسجل تدقيق متسلسل الهاش ترقية لاحقة.
 */

import type { PipelineEvent, StageId, StageStatus } from "@agentbridge/shared";

export interface EventLog {
  /** يلحق حدثاً جديداً ويبثه للمشتركين */
  append(event: PipelineEvent): void;
  /** كل الأحداث بترتيب الوقوع — للعرض والتصدير والتشريح */
  all(): readonly PipelineEvent[];
}

export type EventListener = (event: PipelineEvent) => void;

/** ينشئ سجلاً داخل الذاكرة مع مشترِك اختياري */
export function createEventLog(onEvent?: EventListener): EventLog {
  const events: PipelineEvent[] = [];
  return {
    append(event: PipelineEvent): void {
      events.push(event);
      if (onEvent !== undefined) onEvent(event);
    },
    all(): readonly PipelineEvent[] {
      return [...events];
    },
  };
}

/** يبني حدثاً موحد الشكل — زمن ISO لحظة الإنشاء */
export function makeEvent(
  runId: string,
  tenantId: string,
  stage: StageId,
  summary: string,
  stageStatus?: StageStatus,
): PipelineEvent {
  return {
    runId,
    tenantId,
    stage,
    at: new Date().toISOString(),
    summary,
    ...(stageStatus !== undefined ? { stageStatus } : {}),
  };
}
