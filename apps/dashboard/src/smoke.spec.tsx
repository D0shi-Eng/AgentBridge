import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { LoginCard } from "@/components/LoginCard";
import { Logo } from "@/components/ui/Logo";
import { DataTable } from "@/components/ui/DataTable";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Card } from "@/components/ui/Card";
import { FaqSection } from "@/components/marketing/FaqSection";
import { OpenSourceSection } from "@/components/marketing/OpenSourceSection";
import { StatsOverview } from "@/components/StatsOverview";
import { RecentRunsCard } from "@/components/RecentRunsCard";
import { RunCertificateCard } from "@/components/RunCertificateCard";
import { renderWithLocale } from "@/test/locale-wrapper";

// FaqSection وPricingSection خادميتان تقرآن كوكي اللغة — نزوّر next/headers
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "ab-locale" ? { value: "ar" } : undefined) }),
}));

describe("smoke — تغطية المكونات المتبقية", () => {
  it("LoginCard يرسم", () => {
    renderWithLocale(<LoginCard onLogin={() => undefined} />);
    expect(screen.getByText("تسجيل الدخول إلى لوحة AgentBridge")).toBeInTheDocument();
  });
  it("LoginCard يطلق onLogin عند إدخال صالح", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ authenticated: true, tenantId: "tenant1" }) })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => JSON.stringify({ authenticated: true, tenantId: "tenant1", permissions: [] }) }));
    const spy = { called: false } as unknown as { called: boolean; args?: unknown[] };
    const handler = (session: { tenantId: string }) => { spy.called = true; spy.args = [session]; };
    const { container } = renderWithLocale(<LoginCard onLogin={handler} />);
    const inputs = container.querySelectorAll("input");
    // ملء الحقول ثم إرسال النموذج
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: "tenant1" } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: "key123" } });
    fireEvent.click(screen.getByText("دخول"));
    await waitFor(() => expect(spy.called).toBe(true));
  });
  it("Logo يرسم ويخفى عن قارئ الشاشة (زخرفي)", () => {
    const { container } = render(<Logo size={24} />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute("aria-hidden")).toBe("true");
  });
  it("DataTable فارغ", () => {
    render(<DataTable columns={[{ key: "a", header: "A" }]} rows={[]} rowKey={() => "k"} renderCell={() => "x"} empty={<span>فارغ</span>} />);
    expect(screen.getByText("فارغ")).toBeInTheDocument();
  });
  it("DataTable مع صفوف داخل غلاف تمرير", () => {
    render(<DataTable columns={[{ key: "a", header: "A" }]} rows={[{ id: "1" }]} rowKey={(r) => r.id} renderCell={(r) => r.id} ariaLabel="جدول" />);
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
  });
  it("Skeleton يرسم", () => {
    const { container } = render(<SkeletonCard />);
    expect(container.firstChild).not.toBeNull();
  });
  it("Card يرسم", () => {
    render(<Card title="t">c</Card>);
    expect(screen.getByText("t")).toBeInTheDocument();
  });
  it("EmptyState يرسم", () => {
    render(<EmptyState icon="x" title="t" hint="h" />);
    expect(screen.getByText("t")).toBeInTheDocument();
  });
  it("FaqSection يرسم (خادمية مع كوكي مزودة)", async () => {
    const { container } = render(await FaqSection());
    expect(container.textContent?.length).toBeGreaterThan(10);
  });
  it("OpenSourceSection يرسم (خادمية مع كوكي مزودة)", async () => {
    const { container } = render(await OpenSourceSection());
    expect(container.textContent?.length).toBeGreaterThan(10);
  });
  it("StatsOverview يرسم أصفاراً", () => {
    renderWithLocale(<StatsOverview stats={{ totalRuns: 0, activeRuns: 0, grantedCertificates: 0, avgFinalScore: null, lastRunAt: null }} loading={false} />);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(3);
  });
  it("StatsOverview تحميل", () => {
    const { container } = renderWithLocale(<StatsOverview stats={null} loading={true} />);
    expect(container.querySelectorAll(".skeleton").length).toBeGreaterThan(0);
  });
  it("RecentRunsCard فارغ", () => {
    renderWithLocale(<RecentRunsCard runs={[]} hasProjects={true} />);
    expect(screen.getByText("لا عمليات تشغيل بعد")).toBeInTheDocument();
  });
  it("RecentRunsCard مع تشغيل", () => {
    renderWithLocale(<RecentRunsCard runs={[{ runId: "r1", status: "completed", createdAt: new Date().toISOString() }]} hasProjects={true} />);
    expect(screen.getByText("r1")).toBeInTheDocument();
  });
  it("RunCertificateCard يرسم ويستجيب للتنزيل", async () => {
    const onDownload = { called: 0 } as unknown as { called: number };
    const handler = () => { (onDownload as unknown as { called: number }).called += 1; };
    const onDenied = vi.fn();
    renderWithLocale(
      <RunCertificateCard
        runId="r1-test-123"
        cert={{ verificationId: "AB-123", artifactsHash: "abc", finalScore: 90, granted: true, issuedAt: new Date().toISOString() }}
        onDownload={handler}
        onDeniedDownloadAttempt={onDenied}
      />,
    );
    expect(screen.getByText("AB-123")).toBeInTheDocument();
    fireEvent.click(screen.getByText("شهادة JSON"));
    expect((onDownload as unknown as { called: number }).called).toBeGreaterThan(0);
  });
  it("شهادة مرفوضة: زر الحزمة لا ينزّل بل يشرح السبب — لا ادعاء نجاح", () => {
    const handler = vi.fn();
    const onDenied = vi.fn();
    renderWithLocale(
      <RunCertificateCard
        runId="run-demo-123"
        cert={{ verificationId: "AB-124", artifactsHash: "abd", finalScore: 40, granted: false, issuedAt: new Date().toISOString() }}
        onDownload={handler}
        onDeniedDownloadAttempt={onDenied}
      />,
    );
    fireEvent.click(screen.getByText("حزمة الخادم ZIP"));
    expect(handler).not.toHaveBeenCalled();
    expect(onDenied).toHaveBeenCalledOnce();
  });
});
