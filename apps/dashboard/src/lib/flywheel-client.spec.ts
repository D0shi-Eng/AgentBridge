/**
 * اختبارات عميل حلقة التعلّم — منطق نقي بلا شبكة حقيقية.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import { flywheelClient } from "./flywheel-client.js";

const creds = { tenantId: "t1" };

describe("flywheel-client", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("list يطلب /flywheel/lessons ويعيد الدروس", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ lessons: [{ id: "a", specPattern: "p", designDecision: "d", outcome: "success", score: 90, tenantId: "t1", createdAt: new Date().toISOString() }] }), { status: 200 })));
    const result = await flywheelClient.list(creds);
    expect(result.lessons.length).toBe(1);
    expect(result.lessons[0]?.specPattern).toBe("p");
  });

  it("search يبني query وk في المسار", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ lessons: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await flywheelClient.search(creds, "hello world", 3);
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = firstCall[0] as string;
    expect(url).toContain("query=hello%20world");
    expect(url).toContain("k=3");
  });

  it("remove يرسل DELETE للمعرف", async () => {
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);
    await flywheelClient.remove(creds, "id-123");
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const url = firstCall[0] as string;
    const init = firstCall[1] as RequestInit;
    expect(url).toContain("id-123");
    expect(init.method).toBe("DELETE");
  });

  it("يرمي عند فشل HTTP مع رسالة الخادم", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { message: "خطأ مخصص" } }), { status: 400 })));
    await expect(flywheelClient.list(creds)).rejects.toThrow("خطأ مخصص");
  });
});
