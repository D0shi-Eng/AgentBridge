import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";

describe("Card", () => {
  it("يرسم عنواناً ومحتوى", () => {
    render(<Card title="عنوان">محتوى</Card>);
    expect(screen.getByText("عنوان")).toBeInTheDocument();
    expect(screen.getByText("محتوى")).toBeInTheDocument();
  });
});
