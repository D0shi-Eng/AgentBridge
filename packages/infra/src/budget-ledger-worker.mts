/**
 * عامل الميزانية — عملية مستقلة لإثبات ذرية الحجز بين العمليات.
 * يقرأ طلب JSON واحداً من stdin: { tenantId, idempotencyKey, ceilingUsd,
 * budgetUsd, actualUsd? } وينفذ دورة نداء محاكاة (reserve → settle بالفعلية)
 * ويطبع الرد JSON سطراً واحداً. اتصال Redis مستقل كلياً عن الأب.
 */

import { createClient } from "redis";
import { createRedisReservationLedger, adaptRedisV6ForBudget } from "./budget-redis-ledger.js";

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
  const tenantId = String(message["tenantId"] ?? "t");
  const idempotencyKey = String(message["idempotencyKey"] ?? "k");
  const ceilingUsd = Number(message["ceilingUsd"] ?? 1);
  const budgetUsd = Number(message["budgetUsd"] ?? 10);
  const actualUsd = message["actualUsd"] === undefined ? ceilingUsd : Number(message["actualUsd"]);

  const redis = createClient({ url: REDIS_URL, socket: { connectTimeout: 2000 } });
  await redis.connect();
  try {
    const ledger = createRedisReservationLedger(adaptRedisV6ForBudget(redis), () => budgetUsd);
    const reserved = await ledger.reserve({ tenantId, idempotencyKey, ceilingUsd, ttlMs: 30_000 });
    if (!reserved.ok) {
      console.log(JSON.stringify({ reserved: false, reason: reserved.error.code }));
      return;
    }
    const settled = await ledger.settle({ tenantId, idempotencyKey, actualUsd });
    if (!settled.ok) {
      console.log(JSON.stringify({ reserved: true, settled: false, reason: settled.error.code }));
      return;
    }
    console.log(JSON.stringify({ reserved: true, reused: reserved.value.reused, settled: true, overCeiling: settled.value.overCeiling }));
  } finally {
    await redis.quit().catch(() => undefined);
  }
}

main().catch((error: unknown) => {
  console.log(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
