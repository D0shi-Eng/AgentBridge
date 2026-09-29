/**
 * عامل القفل — عملية خفيفة تُشغَّل بعملية مستقلة (tsx) لإثبات القفل التوزيعي
 * **بين عمليات حقيقية**. البروتوكول: يقرأ طلب JSON واحداً من stdin:
 *   { op: "acquire"|"renew"|"release"|"fence", runId, ttlMs?, token? }
 * ويطبع رد JSON سطراً واحداً على stdout ثم يخرج.
 * كل عامل يفتح اتصاله المستقل بـRedis — لا مشاركة حالة مع الأب إطلاقاً.
 */

import { createClient } from "redis";
import { createRedisRunLeaseStore, adaptRedisV6ForLock } from "./run-lock.js";

const REDIS_URL = process.env.AB_LIVE_REDIS_URL ?? "redis://localhost:6380";

function readStdinJson(): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => { buffer += chunk; });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(buffer.trim()) as Record<string, unknown>);
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  });
}

async function main(): Promise<void> {
  const message = await readStdinJson();
  const runId = String(message["runId"] ?? "");
  const ttlMs = typeof message["ttlMs"] === "number" ? message["ttlMs"] : 10_000;
  const token = typeof message["token"] === "string" ? message["token"] : "";
  const redis = createClient({ url: REDIS_URL, socket: { connectTimeout: 2000 } });
  await redis.connect();
  try {
    const store = createRedisRunLeaseStore(adaptRedisV6ForLock(redis));
    if (message["op"] === "acquire") {
      console.log(JSON.stringify(await store.acquire(runId, ttlMs)));
      return;
    }
    if (message["op"] === "renew") {
      console.log(JSON.stringify({ renewed: await store.renew(runId, token, ttlMs) }));
      return;
    }
    if (message["op"] === "release") {
      console.log(JSON.stringify({ released: await store.release(runId, token) }));
      return;
    }
    if (message["op"] === "fence") {
      console.log(JSON.stringify({ fenceNow: await store.currentFence(runId) }));
      return;
    }
    console.log(JSON.stringify({ ok: false, error: "op غير معروف" }));
    process.exitCode = 2;
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
