/**
 * اختبارات نموذج الـStepper — تحويل أحداث التشغيل إلى حالات الخطوات الثماني.
 * التسميات الآن بلغتين فيُختبر العربي والإنجليزي معاً.
 */
import { describe, expect, it } from "vitest";
import { stepAriaLabel, stepperStates } from "./stepper-model.js";
import { parseNdjson, summarize, type RunViewModel } from "./run-model.js";
import type { Locale } from "./locale-state.js";

const AR: Locale = "ar";
const EN: Locale = "en";

function eventsOf(...pairs: Array<[string, string | undefined]>): RunViewModel {
  const text = pairs
    .map(([stage, stageStatus]) =>
      JSON.stringify({
        runId: "r",
        tenantId: "t",
        stage,
        at: "2026-08-24T00:00:00Z",
        summary: stage,
        ...(stageStatus !== undefined ? { stageStatus } : {}),
      }),
    )
    .join("\n");
  return summarize(parseNdjson(text));
}

describe("stepperStates", () => {
  it("بلا أحداث وتشغيل جارٍ: الأولى نشطة والبقية معلقة", () => {
    const states = stepperStates(eventsOf(), false, AR);
    expect(states).toHaveLength(8);
    expect(states[0]?.state).toBe("active");
    expect(states[7]?.state).toBe("pending");
  });

  it("بلا أحداث وتشغيل انتهى: كلها معلقة لا نشطة", () => {
    const states = stepperStates(eventsOf(), true, AR);
    expect(states.every((step) => step.state === "pending")).toBe(true);
  });

  it("المراحل المكتملة done والتي بعدها معلقة أثناء الجري", () => {
    const states = stepperStates(
      eventsOf(["load_spec", "completed"], ["normalize", "completed"], ["analyze", "running"]),
      false,
      AR,
    );
    expect(states[0]?.state).toBe("done");
    expect(states[1]?.state).toBe("done");
    expect(states[2]?.state).toBe("active");
    expect(states[3]?.state).toBe("pending");
  });

  it("آخر حالة للمرحلة هي الغالب: needs_repair ثم completed = done", () => {
    const states = stepperStates(eventsOf(["harden", "needs_repair"], ["harden", "completed"]), false, AR);
    expect(states[5]?.state).toBe("done");
  });

  it("needs_repair المعقّرة تظهر repair لا failed", () => {
    const states = stepperStates(eventsOf(["harden", "needs_repair"]), false, AR);
    expect(states[5]?.state).toBe("repair");
  });

  it("failed وneeds_human نهائيتان تظهران فشلاً", () => {
    expect(stepperStates(eventsOf(["evaluate", "needs_human"]), true, AR)[6]?.state).toBe("failed");
    expect(stepperStates(eventsOf(["normalize", "failed"]), true, AR)[1]?.state).toBe("failed");
  });

  it("التسميات تتبع اللغة: عربية عند ar وإنجليزية عند en", () => {
    const arStates = stepperStates(eventsOf(), true, AR);
    const enStates = stepperStates(eventsOf(), true, EN);
    expect(arStates[0]?.label).toBe("قراءة المواصفة");
    expect(enStates[0]?.label).toBe("Read specification");
  });
});

describe("stepAriaLabel", () => {
  it("يجمع الاسم مع الحكم المقروء باللغة المطلوبة", () => {
    expect(stepAriaLabel({ stage: "analyze", label: "التحليل", state: "done" }, AR)).toContain("اكتملت");
    expect(stepAriaLabel({ stage: "certify", label: "الشهادة", state: "pending" }, AR)).toContain("لم تبدأ");
    expect(stepAriaLabel({ stage: "analyze", label: "Analyze", state: "done" }, EN)).toBe("Analyze: completed");
  });
});
