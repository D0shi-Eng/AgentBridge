/**
 * اختبارات محول L1 الشبكي الشكل — أوامر Redis الصحيحة، المفاتيح، TTL.
 * عميل مزيف موثق الأوامر يحاكي node-redis v4 دون منافذ حقيقية.
 */
import { describe, expect, it } from "vitest";
import { pipelineEventsKey, pipelineStateKey } from "@agentbridge/shared";
import { createRedisShapedEpisodicStore, type RedisCommandsLike } from "./redis-shape.js";

function sampleEvent() {
  return {
    runId: "run-1",
    tenantId: "tenant-a",
    stage: "load_spec" as const,
    at: "2026-08-24T00:00:00Z",
    summary: "انطلقت",
    stageStatus: "running" as const,
  };
}

/** عميل مزيف يسجل كل أمر بالترتيب ويحاكي stream/hash بسيطين */
function fakeClient() {
  const calls: string[] = [];
  const streams = new Map<string, Array<{ id: string; message: Record<string, string> }>>();
  const hashes = new Map<string, Record<string, string>>();
  const expirations = new Map<string, number>();
  let counter = 0;

  const client: RedisCommandsLike = {
    async xAdd(key, _id, fields) {
      calls.push(`xAdd ${key}`);
      const list = streams.get(key) ?? [];
      list.push({ id: `${++counter}`, message: fields });
      streams.set(key, list);
      return `${counter}`;
    },
    async xRange(key) {
      calls.push(`xRange ${key}`);
      return [...(streams.get(key) ?? [])];
    },
    async hSet(key, field, value) {
      calls.push(`hSet ${key} ${field}`);
      const hash = hashes.get(key) ?? {};
      hash[field] = value;
      hashes.set(key, hash);
      return 1;
    },
    async hGetAll(key) {
      calls.push(`hGetAll ${key}`);
      return { ...(hashes.get(key) ?? {}) };
    },
    async expire(key, seconds) {
      calls.push(`expire ${key} ${seconds}`);
      expirations.set(key, seconds);
      return true;
    },
  };
  return { client, calls, expirations, hashes };
}

describe("createRedisShapedEpisodicStore", () => {
  it("الأحداث تُلحق في مفتاح stream الصحيح مع TTL سبعة أيام", async () => {
    const fake = fakeClient();
    const store = createRedisShapedEpisodicStore(fake.client);

    await store.appendEvent("tenant-a", "run-1", sampleEvent());

    expect(fake.calls).toContain(`xAdd ${pipelineEventsKey("tenant-a", "run-1")}`);
    expect(fake.expirations.get(pipelineEventsKey("tenant-a", "run-1"))).toBe(7 * 24 * 60 * 60);
    expect(await store.readEvents("tenant-a", "run-1")).toHaveLength(1);
  });

  it("الحدث المخالف للمخطط يرفض قبل أي أمر Redis", async () => {
    const fake = fakeClient();
    const store = createRedisShapedEpisodicStore(fake.client);
    const bad = { ...sampleEvent(), tenantId: "" } as unknown as Parameters<
      typeof store.appendEvent
    >[2];

    await expect(store.appendEvent("t", "r", bad)).rejects.toThrow(/مدخل غير صالح/);
    expect(fake.calls.length).toBe(0);
  });

  it("snapshot وحالة التشغيل في hash الحالة بحقولها الموثقة مع TTL", async () => {
    const fake = fakeClient();
    const store = createRedisShapedEpisodicStore(fake.client, 100);

    await store.saveSnapshot("tenant-a", "run-1", '{"v":1}');
    await store.saveRunStatus("tenant-a", "run-1", "suspended");

    const stateKey = pipelineStateKey("tenant-a", "run-1");
    expect(fake.expirations.get(stateKey)).toBe(100);
    expect(await store.loadSnapshot("tenant-a", "run-1")).toBe('{"v":1}');
    expect(await store.loadRunStatus("tenant-a", "run-1")).toBe("suspended");
    expect((await store.loadSnapshot("tenant-b", "run-1")) === null).toBe(true);
  });

  it("hash فارغ يعيد null لا كائناً فارغاً (دلالة غياب المفتاح)", async () => {
    const store = createRedisShapedEpisodicStore(fakeClient().client);
    expect(await store.loadRunStatus("t", "missing")).toBeNull();
    expect(await store.loadSnapshot("t", "missing")).toBeNull();
  });
});
