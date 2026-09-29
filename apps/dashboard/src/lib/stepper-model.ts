/**
 * نموذج الـStepper النقي — يحول أحداث التشغيل إلى حالات المراحل الثماني.
 * كل منطق القرار هنا ليُختبر وحدةً بلا DOM، والمكوّن عرض رقيق فوقه.
 * التسميات عبر قاموس i18n الموحد فلا نص عربي صلب.
 */

import { t } from "./i18n";
import type { Locale } from "./locale-shared";
import type { RunViewModel } from "./run-model.js";

/** حالة بصرية لمرحلة واحدة في الـStepper */
export type StepState = "pending" | "active" | "done" | "failed" | "repair";

export interface StepView {
  readonly stage: string;
  readonly label: string;
  readonly state: StepState;
}

/** مفاتيح المراحل الثماني بترتيبها التنفيذي — الترجمة في القاموس (stage.*) */
export const PIPELINE_STAGES: ReadonlyArray<{ stage: string; labelKey: "stage.load_spec" | "stage.normalize" | "stage.analyze" | "stage.design_tools" | "stage.generate_server" | "stage.harden" | "stage.evaluate" | "stage.certify" }> = [
  { stage: "load_spec", labelKey: "stage.load_spec" },
  { stage: "normalize", labelKey: "stage.normalize" },
  { stage: "analyze", labelKey: "stage.analyze" },
  { stage: "design_tools", labelKey: "stage.design_tools" },
  { stage: "generate_server", labelKey: "stage.generate_server" },
  { stage: "harden", labelKey: "stage.harden" },
  { stage: "evaluate", labelKey: "stage.evaluate" },
  { stage: "certify", labelKey: "stage.certify" },
];

/** يترجم حالة حدث مرحلة إلى حالة بصرية للـStepper */
function stateOf(lastStatus: string | null): StepState {
  switch (lastStatus) {
    case "completed":
      return "done";
    case "running":
      return "active";
    case "failed":
    case "needs_human":
      return "failed";
    case "needs_repair":
      // الإصلاح الجاري عملٌ حي لا فشل نهائي — لون تحذيري متحرك
      return "repair";
    default:
      return "pending";
  }
}

/**
 * يبني مشاهد الخطوات الثماني من نموذج التشغيل:
 * آخر حالة لكل مرحلة هي الغالب، وإن لم تصل المرحلة بعد فهي
 * «نشطة» حين التشغيل ما زال جارياً وإلا «معلقة».
 */
export function stepperStates(model: RunViewModel | null, runIsOver: boolean, locale: Locale): StepView[] {
  const rows = model?.rows ?? [];
  const reachedAnyStage = rows.length > 0;
  return PIPELINE_STAGES.map(({ stage, labelKey }, index) => {
    let lastStatus: string | null = null;
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row !== undefined && row.stage === stage && row.status !== null) {
        lastStatus = row.status;
        break;
      }
    }
    const waiting = lastStatus === null;
    const isActiveWaiting = waiting && !runIsOver && reachedAnyStage === false && index === 0;
    const state = waiting ? (isActiveWaiting ? "active" : "pending") : stateOf(lastStatus);
    return { stage, label: t(labelKey, locale), state };
  });
}

/** نص موجز بلغة الواجهة لحالة خطوة — يُستخدم في aria-label واختبار القرار */
export function stepAriaLabel(step: StepView, locale: Locale): string {
  const verdictKeys = {
    pending: "step.pending",
    active: "step.active",
    done: "step.done",
    failed: "step.failed",
    repair: "step.repair",
  } as const;
  return t("step.aria", locale, { name: step.label, state: t(verdictKeys[step.state], locale) });
}
