/**
 * اختبارات middleware CSP — السياسة بـnonce وstrict-dynamic، وdev وحده
 * يضيف unsafe-eval، ولا unsafe-inline للسكربتات إطلاقاً.
 */

import { describe, expect, it, vi } from "vitest";

// next/server لا يعمل في jsdom — الواجهة المستخدمة في الاختبار مصغرة
vi.mock("next/server", () => ({
  NextResponse: { next: vi.fn(() => ({ headers: { set: vi.fn() } })) },
}));

import { buildCsp } from "./middleware";

describe("buildCsp", () => {
  it("يحوي nonce الطلب وstrict-dynamic ولا unsafe-inline للسكربتات", () => {
    const csp = buildCsp("test-nonce==", false);
    expect(csp).toContain("script-src 'self' 'nonce-test-nonce==' 'strict-dynamic'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/u);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
  });

  it("التطوير وحده يضيف unsafe-eval لأدوات Next الحية", () => {
    expect(buildCsp("n", true)).toContain("'unsafe-eval'");
    expect(buildCsp("n", false)).not.toContain("'unsafe-eval'");
  });
});
