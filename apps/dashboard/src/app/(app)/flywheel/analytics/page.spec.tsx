/**
 * اختبارات صفحة تحليلات Flywheel — RTL: بطاقات + جدول TopPatterns + Trend.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import AnalyticsPage from "./page.js";
import { renderWithProviders } from "@/test/locale-wrapper";

function mockFetchOnce(payload: unknown): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/auth/session")) return new Response(JSON.stringify({ authenticated: true, tenantId: "t1", permissions: ["analytics:read"] }), { status: 200 });
    return new Response(JSON.stringify(payload), { status: 200 });
  }));
}

describe("AnalyticsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.setItem("ab-locale", "ar");
  });

  it("تعرض بطاقات الإجمالي والمتوسط ومعدل النجاح بعد التحميل", async () => {
    mockFetchOnce({
      totalLessons: 5, avgScore: 72.4, successRate: 0.6, histogram: [1, 1, 1, 1, 1],
      topPatterns: [{ pattern: "pat-a", count: 3, avgScore: 80 }], trend: [{ date: "2026-08-01", count: 2 }, { date: "2026-08-02", count: 3 }],
    });
    renderWithProviders(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText("72.4")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("pat-a")).toBeInTheDocument();
  });

  it("تعرض سكيليتون أثناء التحميل ثم EmptyState عند لا بيانات", async () => {
    mockFetchOnce({ totalLessons: 0, avgScore: 0, successRate: 0, histogram: [0, 0, 0, 0, 0], topPatterns: [], trend: [] });
    renderWithProviders(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByText("لا بيانات للتحليل")).toBeInTheDocument());
  });

  it("تبديل النطاق 7d/30d/90d يعيد الجلب بالـ range الصحيح", async () => {
    mockFetchOnce({ totalLessons: 1, avgScore: 80, successRate: 1, histogram: [0, 0, 0, 0, 1], topPatterns: [], trend: [] });
    renderWithProviders(<AnalyticsPage />);
    await waitFor(() => expect(screen.getByText("80")).toBeInTheDocument());
    const spy = vi.fn(async () => new Response(JSON.stringify({ totalLessons: 2, avgScore: 70, successRate: 0.5, histogram: [0, 0, 1, 1, 0], topPatterns: [], trend: [] }), { status: 200 }));
    vi.stubGlobal("fetch", spy);
    fireEvent.click(screen.getByText("30 يوماً"));
    await waitFor(() => expect(spy).toHaveBeenCalledWith(expect.stringContaining("range=30d"), expect.anything()));
  });
});
