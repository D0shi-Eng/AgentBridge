import React from "react";
import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithLocale } from "@/test/locale-wrapper";
import { Pill } from "./Pill";

describe("Pill", () => {
  it("يعرض الحالة completed", () => {
    renderWithLocale(<Pill status="completed" />);
    expect(screen.getByText(/مكتمل|completed/i)).toBeInTheDocument();
  });
  it("يعرض running", () => {
    renderWithLocale(<Pill status="running" />);
    expect(screen.getByText(/جارٍ|running/i)).toBeInTheDocument();
  });
});
