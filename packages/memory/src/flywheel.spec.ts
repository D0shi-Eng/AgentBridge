/** اختبارات عزل Flywheel الإلزامي وسلامة adapter. */
import { describe, expect, it } from "vitest";
import { createInMemoryFlywheelStore, LessonSchema } from "./flywheel.js";
import { testContext } from "./test-tenant-context.js";

const lesson = (tenantId: string, decision: string, score: number) => ({
  specPattern: "hash-aaa", designDecision: decision, outcome: "success" as const,
  score, tenantId, createdAt: new Date().toISOString(),
});

describe("FlywheelStore in-memory", () => {
  it("يحفظ ويسترجع داخل السياق فقط", async () => {
    const store = createInMemoryFlywheelStore();
    await store.saveLesson(testContext("a"), lesson("a", "A", 80));
    await store.saveLesson(testContext("b"), lesson("b", "B", 99));
    expect((await store.topK(testContext("a"), "hash-aaa", 5)).map((item) => item.tenantId)).toEqual(["a"]);
    expect((await store.topK(testContext("b"), "hash-aaa", 5))[0]?.score).toBe(99);
  });

  it("يرفض اختلاف tenant بين السياق والدرس", async () => {
    const store = createInMemoryFlywheelStore();
    await expect(store.saveLesson(testContext("a"), lesson("b", "B", 10))).rejects.toThrow(/لا يطابق/u);
  });

  it("يرفض سياقاً مفقوداً أثناء التشغيل قبل البحث", async () => {
    const store = createInMemoryFlywheelStore();
    await expect(store.topK(undefined as unknown as ReturnType<typeof testContext>, "x", 1)).rejects.toThrow(/سياق/u);
  });

  it("يرتب ويحذف داخل المستأجر ولا يحذف فهرس الآخر", async () => {
    const removed: string[] = [];
    const vector = { upsert: async () => {}, remove: async (_ctx: ReturnType<typeof testContext>, _ns: "tool", id: string) => { removed.push(id); }, search: async () => [] };
    const store = createInMemoryFlywheelStore(vector);
    await store.saveLesson(testContext("a"), lesson("a", "low", 20));
    await store.saveLesson(testContext("a"), lesson("a", "high", 90));
    const recent = await store.listRecent(testContext("a"), 5);
    expect(recent.map((item) => item.score)).toEqual([90, 20]);
    await store.deleteLesson(testContext("b"), recent[0]?.id ?? "");
    expect(await store.listRecent(testContext("a"), 5)).toHaveLength(2);
    await store.deleteLesson(testContext("a"), recent[0]?.id ?? "");
    expect(removed).toHaveLength(1);
  });

  it("يتحقق من مخطط الدرس ويعالج حدود البحث", async () => {
    expect(LessonSchema.safeParse({ ...lesson("a", "x", 10), specPattern: "" }).success).toBe(false);
    const store = createInMemoryFlywheelStore();
    expect(await store.topK(testContext("a"), "", 3)).toEqual([]);
    expect(await store.topK(testContext("a"), "x", 0)).toEqual([]);
  });
});
