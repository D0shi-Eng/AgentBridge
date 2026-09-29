/**
 * اختبارات نموذج التشغيل وعميل الـAPI — منطق اللوحة النقي.
 */
import { describe, expect, it, vi } from "vitest";
import { isTerminal, parseNdjson, summarize } from "./run-model.js";

function event(stage: string, stageStatus?: string): Record<string, unknown> {
  return {
    runId: "r1",
    tenantId: "t1",
    stage,
    at: "2026-08-24T00:00:00Z",
    summary: `حدث ${stage}`,
    ...(stageStatus !== undefined ? { stageStatus } : {}),
  };
}

describe("parseNdjson", () => {
  it("يفك الأسطر المتعددة ويتجاهل الفارغة والتالفة", () => {
    const text = [JSON.stringify(event("load_spec", "running")), "", "{broken", JSON.stringify(event("normalize"))].join("\n");
    const events = parseNdjson(text);
    expect(events).toHaveLength(2);
    expect(events[0]?.stage).toBe("load_spec");
    expect(events[1]?.stageStatus).toBeUndefined();
  });

  it("نص فارغ يعيد قائمة فارغة لا استثناء", () => {
    expect(parseNdjson("")).toEqual([]);
  });
});

describe("summarize", () => {
  it("يبني صفوفاً بالترتيب ويحصي المراحل المكتملة من الثماني", () => {
    const events = parseNdjson(
      [
        event("load_spec", "running"),
        event("load_spec", "completed"),
        event("normalize", "running"),
        event("normalize", "completed"),
        event("analyze", "running"),
      ]
        .map((e) => JSON.stringify(e))
        .join("\n"),
    );
    const model = summarize(events);
    expect(model.rows).toHaveLength(5);
    expect(model.completedStages).toBe(2);
    expect(model.currentStage).toBe("analyze");
  });

  it("آخر حالة للمرحلة هي الغالب عند تكرارها (إعادة/إصلاح)", () => {
    const events = parseNdjson(
      [event("harden", "needs_repair"), event("harden", "completed")].map((e) => JSON.stringify(e)).join("\n"),
    );
    expect(summarize(events).completedStages).toBe(1);
    expect(summarize(events).rows.at(-1)?.status).toBe("completed");
  });
});

describe("isTerminal", () => {
  it("يعترف بالنواتج الثلاثة فقط", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("failed")).toBe(true);
    expect(isTerminal("needs_human")).toBe(true);
    expect(isTerminal("running")).toBe(false);
    expect(isTerminal("suspended")).toBe(false);
    expect(isTerminal(null)).toBe(false);
  });
});

describe("api-client — بناء النداءات", () => {
  it("لا يرسل bearer ويحوّل فشل المغلف إلى ApiError عربي", async () => {
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { code: "UNAUTHORIZED", message: "بيانات المصادقة غير صالحة" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const { api, ApiError } = await import("./api-client.js");
    const promise = api.listProjects({ tenantId: "t" });
    await expect(promise).rejects.toBeInstanceOf(ApiError);
    await promise.catch((error) => {
      expect((error as InstanceType<typeof ApiError>).code).toBe("UNAUTHORIZED");
      expect(error.message).toContain("المصادقة");
    });
    const call = fetchMock.mock.calls[0]?.[0] as string;
    expect(call).toBe("/api/projects");
    const sentHeaders = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(sentHeaders.headers).has("authorization")).toBe(false);
    expect(sentHeaders.credentials).toBe("include");
  });

  it("نجاح بجسم فارغ يعيد كائناً لا استثناء JSON", async () => {
    vi.resetModules();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" }),
    );
    const { api } = await import("./api-client.js");
    const result = await api.reject({ tenantId: "t" }, "run-1");
    expect(result).toEqual({});
  });
});
