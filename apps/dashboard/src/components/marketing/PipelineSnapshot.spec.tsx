/**
 * اختبارات PipelineSnapshot — لقطة الهبوط من مكونات اللوحة الحقيقية.
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithLocale } from "@/test/locale-wrapper";
import { PipelineSnapshot } from "./PipelineSnapshot";

describe("PipelineSnapshot", () => {
  it("يرسم لقطة كاملة بلا أخطاء ويحتوي Stepper وScoreRing", () => {
    renderWithLocale(<PipelineSnapshot locale="ar" />);
    expect(screen.getByText("مثال على نتيجة تشغيل مكتمل في لوحة التحكم")).toBeInTheDocument();
    expect(screen.getByLabelText("مراحل مسار المعالجة الثماني")).toBeInTheDocument();
    expect(screen.getByText("94")).toBeInTheDocument();
  });

  it("يعرض بطاقات أدوات نموذجية", () => {
    renderWithLocale(<PipelineSnapshot locale="ar" />);
    expect(screen.getByText("search_appointments")).toBeInTheDocument();
    expect(screen.getByText("create_patient_note")).toBeInTheDocument();
  });

  it("وسم العرض التوضيحي ظاهر دائماً — صدق المنتج", () => {
    renderWithLocale(<PipelineSnapshot locale="ar" />);
    expect(screen.getByText(/توضيحي ببيانات اصطناعية/)).toBeInTheDocument();
  });
});
