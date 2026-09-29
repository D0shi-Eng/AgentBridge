/**
 * اختبارات بطاقة الاتصال المحلي — التأسيس التلقائي بلا شاشة مفتاح:
 * تنادي الجلسة المحلية مرة واحدة عند الظهور وتنتقل للوحة، والفشل يعرض
 * رسالة تشغيلية واحدة مع إعادة محاولة، ولا يوجد أي مسار إلى شاشة المفتاح.
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithLocale } from "@/test/locale-wrapper";

const localSession = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  api: {
    localSession: localSession,
    session: async () => ({ authenticated: true, tenantId: "local", permissions: [] }),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
}));

import { LocalConnectCard } from "@/components/LocalConnectCard";

describe("بطاقة الاتصال المحلي", () => {
  beforeEach(() => { localSession.mockReset(); });

  it("تؤسس الجلسة تلقائياً عند الظهور وتنتقل للوحة بلا أي إدخال", async () => {
    localSession.mockResolvedValueOnce({ authenticated: true, tenantId: "local" });
    const onLogin = vi.fn();
    renderWithLocale(<LocalConnectCard onLogin={onLogin} />);
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ tenantId: "local" }));
    expect(localSession).toHaveBeenCalledTimes(1);
    // لا حقول إدخال ولا زر إعادة عند النجاح — لا شيء يلمسه المستخدم
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("إعادة المحاولة")).toBeNull();
  });

  it("الفشل يعرض رسالة تشغيلية واحدة وزر إعادة محاولة ثم ينجح بالتكرار", async () => {
    localSession.mockRejectedValueOnce(new (await import("@/lib/api-client")).ApiError(403, "FORBIDDEN", "x"));
    const onLogin = vi.fn();
    renderWithLocale(<LocalConnectCard onLogin={onLogin} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onLogin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("إعادة المحاولة"));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith({ tenantId: "local" }));
    expect(localSession).toHaveBeenCalledTimes(2);
  });

  it("لا شاشة مفتاح إطلاقاً — نجاحاً أو فشلاً", async () => {
    localSession.mockRejectedValueOnce(new (await import("@/lib/api-client")).ApiError(403, "FORBIDDEN", "x"));
    renderWithLocale(<LocalConnectCard onLogin={() => undefined} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByText("تسجيل الدخول إلى لوحة AgentBridge")).toBeNull();
  });
});
