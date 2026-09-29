/**
 * اختبارات قشرة التطبيق الموحدة — تنقل بحالة نشطة، وسم تخطي،
 * بوابة صلاحية العرض لرابط SSO، وخروج واضح.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { AppShell, Breadcrumbs } from "./AppShell";
import { SessionProvider } from "@/lib/use-session";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { renderWithLocale } from "@/test/locale-wrapper";

// usePathname غير متاح في jsdom — نزوّره بمسار قابل للضبط لكل حالة
let currentPath = "/app";
vi.mock("next/navigation", () => ({
  usePathname: () => currentPath,
}));

function mount(ui: React.ReactElement, session: { tenantId: string; permissions: string[] } | null, localMode = false): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input).includes("/auth/local/mode")) {
      return new Response(JSON.stringify({ enabled: localMode }), { status: 200 });
    }
    if (String(input).includes("/auth/session")) {
      return session === null
        ? new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "x" } }), { status: 401 })
        : new Response(JSON.stringify({ authenticated: true, ...session }), { status: 200 });
    }
    return new Response(JSON.stringify({ deleted: true }), { status: 200 });
  }));
  renderWithLocale(
    <SessionProvider>
      <ToastProvider>{ui}</ToastProvider>
    </SessionProvider>,
  );
}

describe("AppShell", () => {
  beforeEach(() => {
    currentPath = "/app";
    vi.restoreAllMocks();
  });

  it("يرسم روابط التنقل الخمس ورابط التجاوز", async () => {
    mount(<AppShell>م</AppShell>, { tenantId: "t1", permissions: [] });
    await waitFor(() => expect(screen.getAllByText("t1").length).toBeGreaterThan(0));
    expect(screen.getByRole("navigation", { name: "التنقل الرئيسي" })).toBeInTheDocument();
    expect(screen.getByText("اللوحة")).toBeInTheDocument();
    expect(screen.getByText("حلقة التعلّم")).toBeInTheDocument();
    expect(screen.getByText("التحليلات")).toBeInTheDocument();
    expect(screen.getByText("المراقبة")).toBeInTheDocument();
    expect(screen.getByText("تجاوز إلى المحتوى")).toBeInTheDocument();
  });

  it("الحالة النشطة aria-current على الرابط المطابق للمسار", async () => {
    currentPath = "/flywheel";
    mount(<AppShell>م</AppShell>, { tenantId: "t1", permissions: [] });
    await waitFor(() => expect(screen.getByText("حلقة التعلّم")).toHaveAttribute("aria-current", "page"));
  });

  it("رابط SSO مخفي بلا صلاحية — العرض فقط والتفويض للخادم", async () => {
    mount(<AppShell>م</AppShell>, { tenantId: "t1", permissions: [] });
    await waitFor(() => expect(screen.getAllByText("t1").length).toBeGreaterThan(0));
    expect(screen.queryByText("إعدادات الدخول")).toBeNull();
  });

  it("مع صلاحية sso:manage يظهر رابط الإعدادات", async () => {
    mount(<AppShell>م</AppShell>, { tenantId: "t1", permissions: ["sso:manage"] });
    await waitFor(() => expect(screen.getByText("إعدادات الدخول")).toBeInTheDocument());
  });

  it("زر الخروج ينادي logout ويصدر توست", async () => {
    mount(<AppShell>م</AppShell>, { tenantId: "t1", permissions: [] });
    await waitFor(() => expect(screen.getAllByText("خروج").length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByText("خروج")[0] as HTMLElement);
    await waitFor(() => expect(screen.getByText("تم تسجيل الخروج")).toBeInTheDocument());
  });

  it("بلا جلسة لا تظهر منطقة المستخدم", () => {
    mount(<AppShell>م</AppShell>, null);
    expect(screen.queryByText("خروج")).toBeNull();
  });

  it("الوضع المحلي يعرض عبارة مفهومة بدل معرف local ويخفي زر الخروج", async () => {
    mount(<AppShell>م</AppShell>, { tenantId: "local", permissions: [] }, true);
    // العبارة العربية الظاهرة مكان «مساحة العمل: local» — والقيمة الخام في التلميح فقط
    await waitFor(() => expect(screen.getAllByText("وضع محلي على جهازك").length).toBeGreaterThan(0));
    expect(screen.queryByText("مساحة العمل:")).toBeNull();
    expect(screen.queryByText("خروج")).toBeNull();
  });
});

describe("Breadcrumbs", () => {
  it("يعرض ol بـaria-label والعنصر الأخير aria-current", () => {
    renderWithLocale(
      <Breadcrumbs items={[{ label: "اللوحة", href: "/app" }, { label: "تشغيل" }]} />,
    );
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("تشغيل")).toHaveAttribute("aria-current", "page");
  });
});
