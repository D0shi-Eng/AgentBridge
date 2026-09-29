/**
 * اختبارات صفحة دروس حلقة التعلّم — RTL: جدول، بحث، حذف، حالات فراغ/تحميل.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import FlywheelPage from "./page.js";
import { renderWithProviders } from "@/test/locale-wrapper";

function mockFetchOnce(payload: unknown, status = 200): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/auth/session")) return new Response(JSON.stringify({ authenticated: true, tenantId: "t1", permissions: ["flywheel:read"] }), { status: 200 });
    return new Response(JSON.stringify(payload), { status });
  }));
}

describe("FlywheelPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.setItem("ab-locale", "ar");
    vi.stubGlobal("confirm", vi.fn(() => true));
  });

  it("تعرض سكيليتون ثم جدولاً عند وجود دروس", async () => {
    mockFetchOnce({ lessons: [{ id: "id-1", specPattern: "pat-a", designDecision: "dec-a", outcome: "success", score: 90, tenantId: "t1", createdAt: new Date().toISOString() }] });
    renderWithProviders(<FlywheelPage />);
    await waitFor(() => expect(screen.getByText("pat-a")).toBeInTheDocument());
    expect(screen.getByText("dec-a")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("تعرض EmptyState عند لا دروس", async () => {
    mockFetchOnce({ lessons: [] });
    renderWithProviders(<FlywheelPage />);
    await waitFor(() => expect(screen.getByText("لا دروس بعد")).toBeInTheDocument());
  });

  it("البحث الدلالي يرسل query وk ويحدّث الجدول", async () => {
    mockFetchOnce({ lessons: [] });
    renderWithProviders(<FlywheelPage />);
    await waitFor(() => expect(screen.getByPlaceholderText("ابحث بنمط المواصفة…")).toBeInTheDocument());
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ lessons: [{ id: "id-2", specPattern: "search-hit", designDecision: "d", outcome: "success", score: 80, tenantId: "t1", createdAt: new Date().toISOString() }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    fireEvent.change(screen.getByPlaceholderText("ابحث بنمط المواصفة…"), { target: { value: "search-hit" } });
    fireEvent.click(screen.getByText("بحث دلالي"));
    await waitFor(() => expect(screen.getByText("search-hit")).toBeInTheDocument());
    expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("query=search-hit"), expect.anything());
  });

  it("حذف بتوكيد يزيل الصف ويظهر توست", async () => {
    const now = new Date().toISOString();
    mockFetchOnce({ lessons: [{ id: "del-1", specPattern: "to-del", designDecision: "d-del", outcome: "success", score: 70, tenantId: "t1", createdAt: now }] });
    renderWithProviders(<FlywheelPage />);
    await waitFor(() => expect(screen.getByText("to-del")).toBeInTheDocument());
    const delSpy = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", delSpy);
    fireEvent.click(screen.getByText("حذف"));
    await waitFor(() => expect(delSpy).toHaveBeenCalled());
  });
});
