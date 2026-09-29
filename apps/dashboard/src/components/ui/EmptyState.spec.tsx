import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("يعرض عنواناً وتلميحاً", () => {
    render(<EmptyState icon="📡" title="فارغ" hint="تلميح" />);
    expect(screen.getByText("فارغ")).toBeInTheDocument();
    expect(screen.getByText("تلميح")).toBeInTheDocument();
  });
});
