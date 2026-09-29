/**
 * اختبارات حصة اتصالات SSE الموزعة.
 *
 * المستوى الوحدوي: قرار الحجز من ردود Lua مصطنعة + فشل المخزن يتصاعد
 * (المسار يترجمه fail-closed) — نمط rate-limit-redis.spec.
 * المستوى الحي (مشروط بـRedis فعلي): نسختان مخزنتان فوق نفس Redis —
 * الحصة حصرية مجتمعة، التحرر يعيد المقعد عبر النسختين، والعدّ صحيح.
 */

import { createConnection } from "node:net";
import { createClient as createRedisClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adaptRedisV6ForLock, createRedisSseQuotaStore, type SseQuotaStore } from "@agentbridge/infra";

const REDIS_HOST = "127.0.0.1";
/** منفذ Redis الحي قابل للتوجيه بالبيئة — بيئة الاختبار المؤقتة لا المنفذ الافتراضي حصراً */
const REDIS_PORT = Number(process.env.AB_LIVE_REDIS_PORT ?? 6380);

/** فحص قراءة فقط: هل Redis الحي مستجيب؟ (غيابه = تخطٍّ موثق باسمه) */
function redisUp(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: REDIS_HOST, port: REDIS_PORT, timeout: 2000 });
    socket.on("connect", () => { socket.destroy(); resolve(true); });
    socket.on("error", () => { socket.destroy(); resolve(false); });
    socket.on("timeout", () => { socket.destroy(); resolve(false); });
  });
}

describe("قرار الحجز من ردود Lua وسياسة الفشل", () => {
  it("دون بلوغ الحصة يُحجز، وعند بلوغها يُرفض بلا استثناء", async () => {
    const replies: unknown[] = [["1", "1"], ["0", "3"]];
    let call = 0;
    const store = createRedisSseQuotaStore(
      { eval: async () => replies[call++] },
      { keyPrefix: "sse:test", limit: 3, ttlMs: 90_000 },
    );
    expect(await store.acquire("t-a")).toBe(true);
    expect(await store.acquire("t-a")).toBe(false);
  });

  it("فشل المخزن يتصاعد للمسار (fail-closed فوقه) — لا قيمة مصطنعة تسمح", async () => {
    const store = createRedisSseQuotaStore(
      { eval: async () => { throw new Error("connection refused"); } },
      { keyPrefix: "sse:test", limit: 3, ttlMs: 90_000 },
    );
    await expect(store.acquire("t-b")).rejects.toThrow();
  });

  it("countOf يقرأ الصفر عند غياب المفتاح (null آمن)", async () => {
    const store = createRedisSseQuotaStore(
      { eval: async () => null },
      { keyPrefix: "sse:test", limit: 3, ttlMs: 90_000 },
    );
    expect(await store.countOf("t-c")).toBe(0);
  });
});

const liveRedisUp = await redisUp();

describe.skipIf(!liveRedisUp)("الحصة حصرية عبر نسختين (Redis حي)", () => {
  // مفتاح اختبار مميز يُمسح بعد الجلسة — بلا مساس مفاتيح غيره
  const PREFIX = "sse:quota-test";
  const TENANT = "t-quota";
  let first: SseQuotaStore;
  let second: SseQuotaStore;
  let client: ReturnType<typeof createRedisClient>;

  beforeAll(async () => {
    client = createRedisClient({ url: `redis://${REDIS_HOST}:${REDIS_PORT}` });
    await client.connect();
    // نفس سطح أوامر القفل الحي فوق عميل واحد — نمط redis-connector
    const lockCommands = adaptRedisV6ForLock(client);
    first = createRedisSseQuotaStore(lockCommands, { keyPrefix: PREFIX, limit: 2, ttlMs: 90_000 });
    second = createRedisSseQuotaStore(lockCommands, { keyPrefix: PREFIX, limit: 2, ttlMs: 90_000 });
  }, 15_000);

  afterAll(async () => {
    // تنظيف ما أنشأناه فقط: مسح مفتاح الاختبار المميز ثم إنهاء الاتصال
    await client.del(`${PREFIX}:${TENANT}`).catch(() => undefined);
    await client.quit().catch(() => undefined);
  });

  it("مقعدان عبر النسختين حصراً — الثالث من أي نسخة يُرفض، والتحرير يعيد المقعد", async () => {
    expect(await first.acquire(TENANT)).toBe(true);
    expect(await second.acquire(TENANT)).toBe(true);
    expect(await first.acquire(TENANT)).toBe(false);
    expect(await second.acquire(TENANT)).toBe(false);
    expect(await second.countOf(TENANT)).toBe(2);
    // تحرير من النسخة الأولى يتيح المقعد للنسخة الثانية — العدّ مشترك فعلاً
    await first.release(TENANT);
    expect(await second.acquire(TENANT)).toBe(true);
    // التحرر المزدوج بأرضية صفر: تحرير إضافي لا يجعل العدّ سالباً
    await second.release(TENANT);
    await second.release(TENANT);
    expect(await second.countOf(TENANT)).toBe(0);
  });

  it("refresh يجدد عمر المفتاح ولا يغيّر العدّ", async () => {
    expect(await first.acquire(TENANT)).toBe(true);
    const before = await first.countOf(TENANT);
    await second.refresh(TENANT);
    expect(await second.countOf(TENANT)).toBe(before);
    await first.release(TENANT);
  });
});
