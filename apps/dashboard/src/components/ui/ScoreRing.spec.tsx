/**
 * اختبارات ScoreRing — حلقة الدرجة الموحدة.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithLocale } from "@/test/locale-wrapper";
import { ScoreRing, scoreRingColor } from "./ScoreRing";

describe("ScoreRing", () => {
  it("scoreRingColor يميز المنح (أخضر) عن عدم المنح (عنبري تحذيري لا أحمر فشل)", () => {
    expect(scoreRingColor(true)).toBe("#22c55e");
    expect(scoreRingColor(false)).toBe("#fbbf24");
  });

  it("يعرض الدرجة والنص الافتراضي عند المنح", () => {
    renderWithLocale(<ScoreRing score={94} granted={true} />);
    expect(screen.getByText("94")).toBeInTheDocument();
    expect(screen.getByText("شهادة ممنوحة")).toBeInTheDocument();
  });

  it("يعرض نصاً مخصصاً عند التمرير", () => {
    renderWithLocale(<ScoreRing score={42} granted={false} caption="مخصصة" />);
    expect(screen.getByText("مخصصة")).toBeInTheDocument();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain("42");
  });

  it("حالة فراغ: درجة صفر بلا انهيار", () => {
    renderWithLocale(<ScoreRing score={0} granted={false} />);
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
