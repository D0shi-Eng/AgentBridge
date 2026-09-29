/**
 * اختبارات الذاكرة العرضية L1 — الترتيب، بوابة المخطط، الطرد الزمني TTL.
 */
import { describe, expect, it } from "vitest";
import { createInMemoryEpisodicStore } from "./episodic-store.js";

function fakeEvent(sequence: number) {
  return {
    runId: "run-1",
    tenantId: "tenant-a",
    stage: "load_spec" as const,
    at: "2026-08-24T00:00:00Z",
    summary: `حدث ${sequence}`,
    ...(sequence === 1 ? { stageStatus: "running" as const } : {}),
  };
}

describe("createInMemoryEpisodicStore", () => {
  it("يلحق الأحداث ويعيدها بترتيب الوقوع", async () => {
    const store = createInMemoryEpisodicStore();
    await store.appendEvent("tenant-a", "run-1", fakeEvent(1));
    await store.appendEvent("tenant-a", "run-1", fakeEvent(2));

    const events = await store.readEvents("tenant-a", "run-1");
    expect(events).toHaveLength(2);
    expect(events[0]?.summary).toBe("حدث 1");
    expect(events[1]?.summary).toBe("حدث 2");
  });

  it("يرفض حداً لا يطابق مخطط PipelineEvent برسالة عربية", async () => {
    const store = createInMemoryEpisodicStore();
    const bad = { ...fakeEvent(1), tenantId: "" } as unknown as Parameters<typeof store.appendEvent>[2];
    await expect(store.appendEvent("tenant-a", "run-1", bad)).rejects.toThrow(/مدخل غير صالح/);
  });

  it("يعزل المستأجرين: أحداث A لا تُرى من B", async () => {
    const store = createInMemoryEpisodicStore();
    await store.appendEvent("tenant-a", "run-1", fakeEvent(1));
    expect(await store.readEvents("tenant-b", "run-1")).toHaveLength(0);
  });

  it("يطرد الأحداث والمفاتيح بعد انتهاء مدة الاحتفاظ ويجدد العمر مع كل كتابة", async () => {
    let clock = 1_000_000;
    const store = createInMemoryEpisodicStore({ ttlSeconds: 100, now: () => clock });

    await store.saveRunStatus("tenant-a", "run-1", "running");
    await store.appendEvent("tenant-a", "run-1", fakeEvent(1));
    clock += 90_000;
    // التجديد بالكتابة يبقيها حية رغم اقتراب الحد
    await store.appendEvent("tenant-a", "run-1", fakeEvent(2));
    clock += 90_000;
    expect(await store.readEvents("tenant-a", "run-1")).toHaveLength(2);

    clock += 100_000;
    expect(await store.readEvents("tenant-a", "run-1")).toHaveLength(0);
    expect(await store.loadRunStatus("tenant-a", "run-1")).toBeNull();
  });

  it("snapshot: حفظ واسترجاع ورفض الفراغ", async () => {
    const store = createInMemoryEpisodicStore();
    await store.saveSnapshot("tenant-a", "run-1", '{"integrity":"x"}');
    expect(await store.loadSnapshot("tenant-a", "run-1")).toBe('{"integrity":"x"}');
    expect(await store.loadSnapshot("tenant-b", "run-1")).toBeNull();

    await expect(store.saveSnapshot("tenant-a", "run-2", "")).rejects.toThrow(/غير فارغ/);
  });
});
