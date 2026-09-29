/**
 * نموذج التشغيل النقي — دوال حتمية تحوّل أحداث NDJSON الخام إلى
 * حالة عرض جاهزة للواجهة. كل منطق القرار هنا ليُختبر وحدةً بلا DOM.
 */

import { t } from "./i18n";
import type { UiKey } from "./i18n/ar";
import type { PipelineEvent } from "@agentbridge/shared";

/** حالات نهائية يتوقف عندها الاستقصاء */
export const TERMINAL_STATUSES = ["completed", "failed", "needs_human"] as const;

export function isTerminal(status: string | null): boolean {
  return status !== null && (TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface StageRow {
  readonly stage: string;
  readonly status: string | null;
  readonly summary: string;
  readonly at: string;
  /** كود الحدث المستقر — العرض المترجم يمر عبره لا عبر summary */
  readonly code?: string;
  /** معاملات منظمة (أرقام/أكواد ASCII) للاستيفاء في الترجمة */
  readonly params?: Readonly<Record<string, string | number>>;
}

export interface RunViewModel {
  /** صف لكل حدث بالترتيب — اللوحة تعرضه خط زمني */
  readonly rows: StageRow[];
  /** آخر مرحلة وصلها التشغيل (لشريط التقدم) */
  readonly currentStage: string | null;
  /** عدد المراحل المكتملة من الثماني */
  readonly completedStages: number;
}

const STAGE_ORDER = [
  "load_spec",
  "normalize",
  "analyze",
  "design_tools",
  "generate_server",
  "harden",
  "evaluate",
  "certify",
] as const;

/** يفك نص NDJSON إلى أحداث متحققة الشكل الأساسي، متجاهلاً الأسطر الفارغة */
export function parseNdjson(text: string): PipelineEvent[] {
  const events: PipelineEvent[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as Partial<PipelineEvent>;
      if (typeof parsed.stage === "string" && typeof parsed.summary === "string") {
        events.push({
          runId: String(parsed.runId ?? ""),
          tenantId: String(parsed.tenantId ?? ""),
          stage: parsed.stage as PipelineEvent["stage"],
          at: String(parsed.at ?? ""),
          summary: parsed.summary,
          ...(parsed.stageStatus !== undefined ? { stageStatus: parsed.stageStatus } : {}),
          ...(parsed.code !== undefined ? { code: parsed.code } : {}),
          ...(parsed.params !== undefined ? { params: parsed.params } : {}),
        });
      }
    } catch {
      // سطر تالف يُتخطى — البث الحي قد يقصف وسط سطر
    }
  }
  return events;
}

/** يبني نموذج العرض من الأحداث — أحدث حدث لكل مرحلة هو الغالب */
export function summarize(events: readonly PipelineEvent[]): RunViewModel {
  const rows = events.map((event) => ({
    stage: event.stage,
    status: ("stageStatus" in event ? (event.stageStatus ?? null) : null) as string | null,
    summary: event.summary,
    at: event.at,
    ...(event.code !== undefined ? { code: event.code } : {}),
    ...(event.params !== undefined ? { params: event.params } : {}),
  }));

  let completedStages = 0;
  for (const stage of STAGE_ORDER) {
    const lastForStage = [...events].reverse().find((event) => event.stage === stage);
    if (lastForStage?.stageStatus === "completed") completedStages += 1;
  }

  const currentStage = events.length > 0 ? (events[events.length - 1]?.stage ?? null) : null;
  return { rows, currentStage, completedStages };
}

/**
 * خريطة أكواد الأحداث المستقرة ← مفاتيح الترجمة.
 * الكود لغة محايدة تأتي من الخادم؛ هذه الخريطة هي العقد الوحيد بينه وبين
 * قواميس الواجهة — كود بلا مفتاح يسقط في event_unknown الآمن لا يعرض خاماً.
 */
const EVENT_TEXT_KEYS: Record<string, UiKey> = {
  "spec.received": "event_spec_received",
  "spec.normalized": "event_spec_normalized",
  "analyze.completed": "event_analyze_completed",
  "design.completed": "event_design_completed",
  "generate.completed": "event_generate_completed",
  "harden.passed": "event_harden_passed",
  "evaluate.completed": "event_evaluate_completed",
  "certify.granted": "event_certify_granted",
  "certify.denied": "event_certify_denied",
  "repair.completed": "event_repair_completed",
  "stage.started": "event_stage_started",
  "run.suspended": "event_run_suspended",
  "run.failed": "event_run_failed",
  "run.retrying": "event_run_retrying",
  "run.retries_exhausted": "event_run_retries_exhausted",
  "run.needs_human": "event_run_needs_human",
  "repair.cycle_started": "event_repair_cycle_started",
};

/**
 * نص الحدث المعروض حسب اللغة:
 * - كود معروف: الترجمة كاملة بالمعاملات المنظمة في اللغتين.
 * - كود غير معروف: رسالة fallback آمنة مترجمة تذكر الكود نفسه (ASCII).
 * - حدث تاريخي بلا كود: العربية تُظهر ملخصه (لغتها أصلية)؛ الإنجليزية
 *   تعرض رسالة محايدة مترجمة — لا تسرب نص عربي إلى واجهة EN إطلاقاً.
 */
export function eventDisplay(
  row: Pick<StageRow, "code" | "params" | "summary">,
  locale: "ar" | "en",
): string {
  if (row.code !== undefined) {
    const key = EVENT_TEXT_KEYS[row.code];
    if (key !== undefined) return t(key, locale, row.params);
    return t("event_unknown", locale, { code: row.code });
  }
  return locale === "ar" ? row.summary : t("run_eventLegacy", locale);
}
