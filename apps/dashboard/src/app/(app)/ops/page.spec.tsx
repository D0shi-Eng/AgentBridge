/**
 * اختبارات صفحة المراقبة — المسار الجلسي للمقاييس، فشل مستقل لكل جزء،
 * تنبيه واحد لا يتكرر، وحالة مكوّنات مترجمة.
 */

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import OpsPage from "./page.js";
import { renderWithProviders } from "@/test/locale-wrapper";

const HEALTH_OK = { status: "ok", db: "ok", redis: "ok", pgvector: "ok", at: new Date().toISOString() };

// Response يُستهلك مرة واحدة — كل نداء يحتاج نسخة جديدة (التأثير يعمل مرتين:
// قبل وبعد جلوس الجلسة) فالموك يبني الاستجابة داخل النداء لا قبله
function mockFetchForOps(metrics: () => Response, health: () => Response): void {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/auth/session")) {
      return new Response(JSON.stringify({ authenticated: true, tenantId: "t1", permissions: ["resource:read", "analytics:read"] }), { status: 200 });
    }
    if (url.includes("/ops/metrics")) return metrics();
    if (url.includes("/health/detailed")) return health();
    return new Response("{}", { status: 200 });
  }));
}

describe("OpsPage", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.setItem("ab-locale", "ar");
  });

  it("تعرض نص المقاييس وجدول حالة المكوّنات مترجماً بعد التحميل", async () => {
    mockFetchForOps(
      () => new Response('http_requests_total{method="GET",route="/health",status="200"} 3\n', { status: 200, headers: { "content-type": "text/plain" } }),
      () => new Response(JSON.stringify(HEALTH_OK), { status: 200 }),
    );
    renderWithProviders(<OpsPage />);
    await waitFor(() => expect(screen.getByText(/http_requests_total/)).toBeInTheDocument());
    // الحالة ok تُعرض «يعمل» لا القيمة الخام — والقيم في أعمدة مترجمة الأسماء
    await waitFor(() => expect(screen.getAllByText("يعمل").length).toBe(3));
    expect(screen.getByText("قاعدة البيانات")).toBeInTheDocument();
    expect(screen.getByText("الذاكرة القصيرة (Redis)")).toBeInTheDocument();
    expect(screen.getByText("الفهرس الدلالي (pgvector)")).toBeInTheDocument();
  });

  it("رفض حصر المشغّل يعرض حالة معلومة محددة لا تنبيه عطل — والصحة تبقى", async () => {
    mockFetchForOps(
      () => new Response(JSON.stringify({ error: { code: "METRICS_OPERATOR_ONLY", message: "مقاييس المنصة العامة محصورة بالمشغّل" } }), { status: 403, headers: { "content-type": "application/json" } }),
      () => new Response(JSON.stringify(HEALTH_OK), { status: 200 }),
    );
    renderWithProviders(<OpsPage />);
    await waitFor(() => expect(screen.getByText(/متاحة للمشغّل فقط/)).toBeInTheDocument());
    // ليست حالة عطل: لا تنبيه «تعذر تحميل مقاييس الطلبات»
    expect(screen.queryByText("تعذر تحميل مقاييس الطلبات")).not.toBeInTheDocument();
    // جدول حالة المكوّنات يبقى ظاهراً مستقلاً
    await waitFor(() => expect(screen.getAllByText("يعمل").length).toBe(3));
  });

  it("فشل المقاييس وحده يعرض تنبيهاً واحداً يسمّيه — والصحة تُعرض رغم ذلك", async () => {
    mockFetchForOps(
      () => new Response("unauthorized", { status: 401 }),
      () => new Response(JSON.stringify(HEALTH_OK), { status: 200 }),
    );
    renderWithProviders(<OpsPage />);
    await waitFor(() => expect(screen.getByText("تعذر تحميل مقاييس الطلبات")).toBeInTheDocument());
    // تنبيه واحد: لا تكرار لنفس الرسالة ولا توست ثانٍ
    expect(screen.getAllByText("تعذر تحميل مقاييس الطلبات").length).toBe(1);
    expect(screen.queryByText("تعذر تحميل حالة المكوّنات")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByText("يعمل").length).toBe(3));
  });

  it("فشل الصحة وحده يسمّى بالاسم — والمقاييس تُعرض", async () => {
    mockFetchForOps(
      () => new Response("metrics 1\n", { status: 200 }),
      () => new Response("boom", { status: 500 }),
    );
    renderWithProviders(<OpsPage />);
    await waitFor(() => expect(screen.getByText("تعذر تحميل حالة المكوّنات")).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText(/metrics 1/)).toBeInTheDocument());
    expect(screen.queryByText("تعذر تحميل مقاييس الطلبات")).not.toBeInTheDocument();
  });

  it("فشل الجزأين معاً تنبيه واحد يجمعهما بلا تكرار", async () => {
    mockFetchForOps(() => new Response("x", { status: 401 }), () => new Response("x", { status: 401 }));
    renderWithProviders(<OpsPage />);
    await waitFor(() => expect(screen.getByText(/تعذر تحميل قِسَم من المراقبة/)).toBeInTheDocument());
    expect(screen.getByText(/تعذر تحميل مقاييس الطلبات/)).toBeInTheDocument();
    expect(screen.getByText(/تعذر تحميل حالة المكوّنات/)).toBeInTheDocument();
    // زر إعادة المحاولة حاضر للفشل المزدوج
    expect(screen.getByText("إعادة المحاولة")).toBeInTheDocument();
  });

  it("زر تحديث يعيد الجلب", async () => {
    mockFetchForOps(() => new Response("a 1\n", { status: 200 }), () => new Response(JSON.stringify(HEALTH_OK), { status: 200 }));
    renderWithProviders(<OpsPage />);
    await waitFor(() => expect(screen.getByText(/a 1/)).toBeInTheDocument());
    const spy = vi.fn(async () => new Response("b 2\n", { status: 200 }));
    vi.stubGlobal("fetch", spy as unknown as typeof fetch);
    const btn = screen.getByText("تحديث");
    btn.click();
    await waitFor(() => expect(spy).toHaveBeenCalled());
  });
});
