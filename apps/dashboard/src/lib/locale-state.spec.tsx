/**
 * اختبارات حالة اللغة — التبديل يحدث html lang/dir فعلياً،
 * يكتب الكوكي للـSSR القادم، والمزامنة بين التبويبات عبر storage.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { LocaleProvider, useLocale } from "@/lib/locale-state";
import { render } from "@testing-library/react";

/** قارئ صغير يعرض الحالة الحالية داخل الشجرة */
function Probe(): React.ReactElement {
  const { locale } = useLocale();
  return <span data-testid="probe">{locale}</span>;
}

function Switcher(): React.ReactElement {
  const { locale, setLocale } = useLocale();
  return (
    <button type="button" onClick={() => setLocale(locale === "ar" ? "en" : "ar")}>
      switch
    </button>
  );
}

describe("LocaleProvider", () => {
  it("الحالة الابتدائية من الخادم تُصب في html lang/dir منذ الترطيب", () => {
    render(
      <LocaleProvider initialLocale="en">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("probe").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
  });

  it("التبديل يغير الحالة وخصال html والكوكي معاً", () => {
    render(
      <LocaleProvider initialLocale="ar">
        <Probe />
        <Switcher />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByText("switch"));
    expect(screen.getByTestId("probe").textContent).toBe("en");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dir).toBe("ltr");
    expect(document.cookie).toContain("ab-locale=en");
  });

  it("التبديل يكتب localStorage لمزامنة التبويبات الأخرى", () => {
    const stored: Record<string, string> = {};
    const setItem = vi.fn((key: string, value: string) => { stored[key] = value; });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(setItem);
    render(
      <LocaleProvider initialLocale="ar">
        <Switcher />
      </LocaleProvider>,
    );
    fireEvent.click(screen.getByText("switch"));
    expect(setItem).toHaveBeenCalledWith("ab-locale", "en");
    vi.restoreAllMocks();
  });
});
