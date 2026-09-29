/**
 * اختبارات مكون Stepper — عرض رقيق فوق stepper-model النقي.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithLocale } from "@/test/locale-wrapper";
import { Stepper } from "./Stepper";
import { summarize, parseNdjson } from "@/lib/run-model";

const demoText = [
  { stage: "load_spec", stageStatus: "completed", summary: "قراءة" },
  { stage: "normalize", stageStatus: "completed", summary: "توحيد" },
]
  .map((e, i) => JSON.stringify({ runId: "r1", tenantId: "t1", at: `2026-08-25T10:0${i}:00.000Z`, ...e }))
  .join("\n");

describe("Stepper", () => {
  it("يعرض المراحل الثماني حتى بلا نموذج (فراغ)", () => {
    renderWithLocale(<Stepper model={null} runIsOver={false} />);
    const list = screen.getByLabelText("مراحل مسار المعالجة الثماني");
    expect(list).toBeInTheDocument();
    expect(list.querySelectorAll("li").length).toBe(8);
  });

  it("يرسم نموذجاً مكتملاً بلا أخطاء", () => {
    const model = summarize(parseNdjson(demoText));
    renderWithLocale(<Stepper model={model} runIsOver={false} />);
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(8);
    // أول مرحلتين مكتملتان
    expect(items[0]?.className).toContain("done");
  });

  it("يحمل تسميات aria صحيحة لكل خطوة", () => {
    const model = summarize(parseNdjson(demoText));
    const { container } = renderWithLocale(<Stepper model={model} runIsOver={true} />);
    const labels = [...container.querySelectorAll("li")].map((li) => li.getAttribute("aria-label"));
    expect(labels.every((l) => typeof l === "string" && l.length > 0)).toBe(true);
  });
});
