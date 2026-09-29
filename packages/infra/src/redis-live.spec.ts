/**
 * اختبار تكامل مشروط لمحول L1 فوق Redis حي عبر عميل node-redis الرسمي.
 *
 * المحول نفسه (redis-shape.ts) لا يُمس — ما يُثبت هنا أن العميل الرسمي
 * الحقيقي يفي بعقده البنيوي: المفاتيح `pipeline:{tenant}:{run}:*`،
 * TTL سبعة أيام يتجدد مع كل كتابة، ودلالات stream/hash كما هي.
 * غياب الخادم = تخطٍّ موثق باسمه (انظر أيضاً vitest.config.ts).
 */
import { createConnection } from "node:net";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient } from "redis";
import { EPISODIC_TTL_SECONDS, pipelineEventsKey, pipelineStateKey } from "@agentbridge/shared";
import type { EpisodicStore } from "@agentbridge/memory";
import { createRedisShapedEpisodicStore } from "./redis-shape.js";

const REDIS_URL = process.env.AB_LIVE_REDIS_URL ?? "redis://localhost:6380";

function portOpen(host: string, port: number, timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("timeout", () => { socket.destroy(); resolve(false); });
    socket.once("error", () => { socket.destroy(); resolve(false); });
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

async function probeRedis(): Promise<boolean> {
  const redis = new URL(REDIS_URL);
  if (!(await portOpen(redis.hostname, Number(redis.port) || 6379))) return false;
  const probe = createClient({ url: REDIS_URL, socket: { connectTimeout: 1500 } });
  try {
    if ((await withTimeout(probe.connect(), 2000)) === null) return false;
    if ((await withTimeout(probe.ping(), 1500)) === null) return false;
    return true;
  } finally {
    await probe.quit().catch(() => undefined);
  }
}

const available = await probeRedis();
if (!available) {
  console.info(
    "[تخطٍّ موثق] اختبار محول L1 التكاملي: لا خادم Redis حي على العنوان المضبوط — " +
      "أقلع docker-compose.dev.yaml أو اضبط AB_LIVE_REDIS_URL لتشغيله",
  );
}

const PREFIX = `it-${randomUUID().slice(0, 8)}`;

function sampleEvent(sequence: number) {
  return {
    runId: `${PREFIX}-run`,
    tenantId: PREFIX,
    stage: "load_spec" as const,
    at: new Date().toISOString(),
    summary: `حدث ${sequence}`,
    stageStatus: "completed" as const,
  };
}

describe.skipIf(!available)("محول L1 فوق Redis حي عبر عميل node-redis الرسمي", () => {
  let client: ReturnType<typeof createClient>;
  let store: EpisodicStore;

  beforeAll(async () => {
    client = createClient({ url: REDIS_URL, socket: { connectTimeout: 1500 } });
    await client.connect();
    // نفس غلاف التوافق مع عقد المحول: expire يعيد boolean في v4 و1|0 في v6
    store = createRedisShapedEpisodicStore({
      xAdd: async (key, id, fields) => client.xAdd(key, id, fields),
      xRange: async (key, start, stop) => client.xRange(key, start, stop),
      hSet: async (key, field, value) => client.hSet(key, field, value),
      hGetAll: async (key) => client.hGetAll(key),
      expire: async (key, seconds) => Boolean(await client.expire(key, seconds)),
    });
  });

  afterAll(async () => {
    // تمحيص مفاتيح الجلسة فقط ثم إنهاء الاتصال بهدوء
    const keys = await client.keys(`${PREFIX}*`);
    if (keys.length > 0) await client.del(keys);
    await client.quit().catch(() => undefined);
  });

  it("الأحداث تصل stream بالمفتاح الموثق وتُقرأ بترتيبها", async () => {
    await store.appendEvent(PREFIX, `${PREFIX}-run`, sampleEvent(1));
    await store.appendEvent(PREFIX, `${PREFIX}-run`, sampleEvent(2));

    const eventsKey = pipelineEventsKey(PREFIX, `${PREFIX}-run`);
    expect(await client.exists(eventsKey)).toBe(1);
    const events = await store.readEvents(PREFIX, `${PREFIX}-run`);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.summary)).toEqual(["حدث 1", "حدث 2"]);
  });

  it("TTL سبعة أيام فعلي على الخادم ويجدد مع كل كتابة", async () => {
    const eventsKey = pipelineEventsKey(PREFIX, `${PREFIX}-run`);
    const stateKey = pipelineStateKey(PREFIX, `${PREFIX}-run`);
    expect(await client.ttl(eventsKey)).toBe(EPISODIC_TTL_SECONDS);

    // كتابة جديدة تتجاوز العمر من جديد — تطبيق العقد لا اتفاق
    await store.appendEvent(PREFIX, `${PREFIX}-run`, sampleEvent(3));
    expect(await client.ttl(eventsKey)).toBe(EPISODIC_TTL_SECONDS);

    await store.saveSnapshot(PREFIX, `${PREFIX}-run`, '{"v":1}');
    await store.saveRunStatus(PREFIX, `${PREFIX}-run`, "suspended");
    expect(await client.ttl(stateKey)).toBe(EPISODIC_TTL_SECONDS);

    expect(await store.loadSnapshot(PREFIX, `${PREFIX}-run`)).toBe('{"v":1}');
    expect(await store.loadRunStatus(PREFIX, `${PREFIX}-run`)).toBe("suspended");
  });

  it("مفتاح مستأجر آخر يعيد غياباً صرفاً (انعزال في الخادم ذاته)", async () => {
    expect(await store.loadSnapshot(`other-${PREFIX}`, `${PREFIX}-run`)).toBeNull();
    expect(await store.readEvents(`other-${PREFIX}`, `${PREFIX}-run`)).toHaveLength(0);
  });
});
