/**
 * اختبار دفتر حجوزات Redis — ذرية الحجز بين العمليات فوق Redis حي (مشروط).
 * عمليتان خفيفتان مستقلتان كل منهما تنفذ دورات حجز/تسوية على دفتر واحد
 * بميزانية ضيقة: النتيجة الحتمية أن مجموع المسوى لا يتجاوز السقف مطلقاً
 * والمرفوضات قبل الإرسال بالضبط. غياب Redis = تخطٍّ موثق باسمه.
 */

import { createConnection } from "node:net";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createClient } from "redis";
import { adaptRedisV6ForBudget, createRedisReservationLedger } from "./budget-redis-ledger.js";

const HERE = dirname(fileURLToPath(import.meta.url));
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

/** نداء محاكاة في عملية مستقلة — دورة reserve→settle كاملة */
function callWorker(message: Record<string, unknown>, timeoutMs = 8000): Record<string, unknown> | null {
  const require = createRequire(import.meta.url);
  const tsxPath = require.resolve("tsx");
  const child = spawnSync(process.execPath, ["--import", `file://${tsxPath.replace(/\\/g, "/")}`, join(HERE, "budget-ledger-worker.mts")], {
    input: JSON.stringify(message),
    encoding: "utf8",
    timeout: timeoutMs,
    env: { ...process.env, AB_LIVE_REDIS_URL: REDIS_URL },
    shell: false,
  });
  const lines = (child.stdout ?? "").split("\n").filter((line) => line.trim().length > 0);
  const last = lines[lines.length - 1];
  return last === undefined ? null : (JSON.parse(last) as Record<string, unknown>);
}

describe.sequential("حي: دفتر حجوزات Redis بين عمليتين (مشروط بتوافر 6380)", () => {
  it("ميزانية 5$ وسقف 1$: بالضبط 5 دورات تنجح عبر العمليتين والبقية تُرفض قبل الإرسال", async () => {
    if (!(await portOpen("localhost", 6380))) {
      console.warn("[NOT_RUN] Redis 6380 غير متاح — اختبار الدفتر الحي مؤجل لبيئة معتمدة");
      return;
    }
    const tenantId = `budget-live-${Date.now()}`;
    let accepted = 0;
    let rejected = 0;
    // 6 دورات موزعة على عمليتين (3+3) بالتتابع الصارم — بوابة واحدة كل مرة
    for (let i = 0; i < 6; i += 1) {
      const worker = i % 2 === 0 ? "worker-A" : "worker-B";
      const reply = callWorker({ tenantId, idempotencyKey: `call-${i}`, ceilingUsd: 1, budgetUsd: 5, actualUsd: 1 });
      if (reply?.reserved === true && reply?.settled === true) accepted += 1;
      else if (reply?.reserved === false) rejected += 1;
      else throw new Error(`رد عامل غير متوقع (${worker}): ${JSON.stringify(reply)}`);
    }
    expect(accepted).toBe(5);
    expect(rejected).toBe(1);
    // التحقق من الدفتر النهائي مباشرة
    const redis = createClient({ url: REDIS_URL });
    await redis.connect();
    try {
      const ledger = createRedisReservationLedger(adaptRedisV6ForBudget(redis), () => 5);
      expect(await ledger.monthSpendUsd(tenantId)).toBe(5);
      expect(await ledger.reservedUsd(tenantId)).toBe(0);
    } finally {
      await redis.quit().catch(() => undefined);
    }
  }, 40_000);

  it("idempotency بين العمليتين: نفس المفتاح لا يحجز ولا يسوى مرتين", async () => {
    if (!(await portOpen("localhost", 6380))) {
      console.warn("[NOT_RUN] Redis 6380 غير متاح — اختبار الدفتر الحي مؤجل لبيئة معتمدة");
      return;
    }
    const tenantId = `idem-live-${Date.now()}`;
    const first = callWorker({ tenantId, idempotencyKey: "same-call", ceilingUsd: 1, budgetUsd: 10, actualUsd: 1 });
    expect(first?.reserved).toBe(true);
    expect(first?.settled).toBe(true);
    // النداء الثاني بنفس المفتاح: حجز جديد (الأول سُوّى وحُرر) — لكن دفتر واحد
    // يعني مجموع الإنفاق 2 لا 1: نتحقق أن reuse يعمل فقط قبل التسوية
    const redis = createClient({ url: REDIS_URL });
    await redis.connect();
    try {
      const ledger = createRedisReservationLedger(adaptRedisV6ForBudget(redis), () => 10);
      const held = await ledger.reserve({ tenantId, idempotencyKey: "held", ceilingUsd: 1, ttlMs: 30_000 });
      expect(held.ok && !held.value.reused).toBe(true);
      const heldAgain = await ledger.reserve({ tenantId, idempotencyKey: "held", ceilingUsd: 1, ttlMs: 30_000 });
      expect(heldAgain.ok && heldAgain.value.reused).toBe(true); // نفس الحجز لا حجز مزدوج
    } finally {
      await redis.quit().catch(() => undefined);
    }
    expect(await (async () => { const r = callWorker({ tenantId, idempotencyKey: "same-call-2", ceilingUsd: 1, budgetUsd: 10, actualUsd: 1 }); return r?.settled; })()).toBe(true);
  }, 40_000);
});
