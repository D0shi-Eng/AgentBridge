import React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithLocale } from "@/test/locale-wrapper";
import { Button } from "./Button";

describe("Button", () => {
  it("يرسم زراً أساسياً", () => {
    renderWithLocale(<Button>نص</Button>);
    expect(screen.getByText("نص")).toBeInTheDocument();
  });
  it("حالة busy تعرض نص الانشغال من القاموس مع aria-busy", () => {
    renderWithLocale(<Button busy>نص</Button>);
    // علامة الحذف في نهاية السلسلة المنطقية (تُعرض يسار العربية)
    expect(screen.getByText("لحظات…")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });
  it("busy بالإنجليزية يعرض النص الإنجليزي", () => {
    renderWithLocale(<Button busy>x</Button>, { locale: "en" });
    expect(screen.getByText("One moment…")).toBeInTheDocument();
  });
});
