"use client";

/** Stepper المراحل الثماني — عرض رقيق فوق stepper-model النقي المختبر.
 * تسميات وحالات بلغة الواجهة، وقائمة عمودية تحت 768px عبر CSS. */

import React from "react";
import { t, useLocale } from "@/lib/i18n";
import { stepAriaLabel, stepperStates } from "@/lib/stepper-model";
import type { RunViewModel } from "@/lib/run-model";

export function Stepper({ model, runIsOver }: { model: RunViewModel | null; runIsOver: boolean }) {
  const { locale } = useLocale();
  const steps = stepperStates(model, runIsOver, locale);
  return (
    <ol className="stepper" aria-label={t("stage.label", locale)}>
      {steps.map((step) => (
        <li key={step.stage} className={`step ${step.state}`} aria-label={stepAriaLabel(step, locale)}>
          {step.label}
        </li>
      ))}
    </ol>
  );
}
