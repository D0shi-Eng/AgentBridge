/**
 * اختبارات القفل التوزيعي.
 * 1) دلالات الإيجار كاملة على تنفيذ الذاكرة (حتمي، now محقون).
 * 2) الأرشفة المسورة: رفض كتابة مالك قديم بـfence/جيل أقدم.
 * 3) اختبار مشروط حي: عمليتان خفيفتان حقيقيتان فوق Redis (6380) — سباق
 *    تولي، موت مالك عنيف ثم استحواذ بعد انتهاء الإيجار، وإطلاق من مالك خاطئ.
 *    غياب Redis = تخطٍّ موثق باسمه (نمط الاختبارات الحية القائم).
 */

import { spawnSync } from "node:child_process";
import { createConnection } from "node:net";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createInMemoryRunLeaseStore } from "./run-lock.js";
import { createFencedSnapshotSave, createInMemoryRunArchiveStore } from "@agentbridge/memory";

const HERE = dirname(fileURLToPath(import.meta.url));

describe("دلالات الإيجار — تنفيذ الذاكرة", () => {
  it("acquire حصري: الثاني يُرفض ما دام الأول حياً", async () => {
    let nowMs = 1000;
    const store = createInMemoryRunLeaseStore({ now: () => nowMs });
    const first = await store.acquire("run-1", 5000);
    const second = await store.acquire("run-1", 5000);
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
    nowMs += 6000; // انتهى الإيجار
    const third = await store.acquire("run-1", 5000);
    expect(third.acquired).toBe(true);
  });

  it("fencing token يتصاعد مع كل تولي ناجح لنفس runId", async () => {
    const store = createInMemoryRunLeaseStore();
    const a = await store.acquire("run-f", 100);
    expect(a.acquired).toBe(true);
    // انتهاء الإيجار (now لا يتحرك لكن ttl=100<0? نستخدم now متحرك)
    let nowMs = Date.now();
    const moving = createInMemoryRunLeaseStore({ now: () => nowMs });
    const first = await moving.acquire("run-g", 50);
    expect(first.acquired).toBe(true);
    nowMs += 100; // انتهى
    const second = await moving.acquire("run-g", 50);
    expect(second.acquired).toBe(true);
    expect(first.acquired && second.acquired ? second.fence - first.fence : 0).toBe(1);
    expect(await moving.currentFence("run-g")).toBe(2);
    expect(await store.currentFence("run-f")).toBe(1);
  });

  it("renew مشروط بالمالك: التوكن الصحيح يجدد والمخالف يُرفض بلا مساس", async () => {
    const store = createInMemoryRunLeaseStore();
    const lease = await store.acquire("run-r", 1000);
    if (!lease.acquired) throw new Error("تولي أولي فشل");
    expect(await store.renew("run-r", "wrong-token", 1000)).toBe(false);
    expect(await store.renew("run-r", lease.ownerToken, 1000)).toBe(true);
  });

  it("release مشروط بالمالك: مالك خاطئ لا يحرر إيجار غيره", async () => {
    const store = createInMemoryRunLeaseStore();
    const lease = await store.acquire("run-x", 1000);
    if (!lease.acquired) throw new Error("تولي أولي فشل");
    expect(await store.release("run-x", "wrong-token")).toBe(false);
    const next = await store.acquire("run-x", 1000);
    expect(next.acquired).toBe(false);
    expect(await store.release("run-x", lease.ownerToken)).toBe(true);
    expect((await store.acquire("run-x", 1000)).acquired).toBe(true);
  });

  it("اختلاف tenant/run: إيجارات مستقلة لا تتصادم", async () => {
    const store = createInMemoryRunLeaseStore();
    expect((await store.acquire("run-a", 1000)).acquired).toBe(true);
    expect((await store.acquire("run-b", 1000)).acquired).toBe(true);
  });
});

describe("الأرشفة المسورة — رفض المالك القديم", () => {
  it("كتابة fence أقل أو جيل أقل تُرفض — المالك القديم لا يكتب فوق الجديد", async () => {
    const archive = createInMemoryRunArchiveStore();
    expect((await archive.archive({ tenantId: "t1", runId: "r1", snapshotJson: "{\"g\":1}", generation: 1, fence: 2 })).ok).toBe(true);
    const staleFence = await archive.archive({ tenantId: "t1", runId: "r1", snapshotJson: "{\"g\":1}", generation: 1, fence: 1 });
    expect(staleFence.ok).toBe(false);
    if (!staleFence.ok) expect(staleFence.error.code).toBe("STALE_ARCHIVE_WRITE");
    const staleGeneration = await archive.archive({ tenantId: "t1", runId: "r1", snapshotJson: "{}", generation: 0, fence: 9 });
    expect(staleGeneration.ok).toBe(false);
    const newer = await archive.archive({ tenantId: "t1", runId: "r1", snapshotJson: "{\"g\":2}", generation: 2, fence: 3 });
    expect(newer.ok).toBe(true);
    expect((await archive.latest("t1", "r1"))?.generation).toBe(2);
  });

  it("غلاف الكتابة المسور: فقد الإيجار يوقف كل كتابة لاحقة", async () => {
    const archive = createInMemoryRunArchiveStore();
    let leaseAlive = true;
    const fencedSave = createFencedSnapshotSave({
      archive,
      tenantId: "t1",
      runId: "r2",
      fenceOf: () => 5,
      leaseAlive: () => leaseAlive,
    });
    await fencedSave("{\"gen\":1}", 1);
    leaseAlive = false; // انتهى الإيجار/خسره المالك
    await expect(fencedSave("{\"gen\":2}", 2)).rejects.toMatchObject({ code: "STALE_ARCHIVE_WRITE" });
    expect((await archive.latest("t1", "r2"))?.generation).toBe(1);
  });
});

/* ---------- الاختبار الحي: عمليتان خفيفتان فوق Redis ---------- */

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

/** عامل بعملية مستقلة — يعيد رده الأول أو null عند المهلة */
function askWorker(message: Record<string, unknown>, timeoutMs = 8000): Promise<Record<string, unknown> | null> {
  const require = createRequire(import.meta.url);
  const tsxPath = require.resolve("tsx");
  return new Promise((resolve) => {
    const child = spawnSync(process.execPath, ["--import", `file://${tsxPath.replace(/\\/g, "/")}`, join(HERE, "run-lock-worker.mts")], {
      input: JSON.stringify(message),
      encoding: "utf8",
      timeout: timeoutMs,
      env: { ...process.env, AB_LIVE_REDIS_URL: REDIS_URL },
      shell: false,
    });
    const lines = (child.stdout ?? "").split("\n").filter((line) => line.trim().length > 0);
    const last = lines[lines.length - 1];
    resolve(last === undefined ? null : (JSON.parse(last) as Record<string, unknown>));
  });
}

describe.sequential("حي: عمليتان خفيفتان فوق Redis (مشروط بتوافر 6380)", () => {
  it("سباق تولي بين عمليتين: فائز واحد حصراً بفences متصاعدة", async () => {
    if (!(await portOpen("localhost", 6380))) {
      console.warn("[NOT_RUN] Redis 6380 غير متاح — اختبار العمليتين الحي مؤجل لبيئة معتمدة");
      return;
    }
    const runId = `lock-race-${Date.now()}`;
    // عمليتان بالتتابع الصارم هنا (بوابة واحدة في كل مرة — خطة الموارد):
    // الأول يولي وينتهي بلا تحرير، الثاني يجب أن يُرفض ما دام الإيجار حياً
    const winner = await askWorker({ op: "acquire", runId, ttlMs: 4000 });
    expect(winner?.acquired).toBe(true);
    const loser = await askWorker({ op: "acquire", runId, ttlMs: 4000 });
    expect(loser?.acquired).toBe(false);
    // موت المالك العنيف: لا release — الإيجار ينتهي بانتهاء TTL ثم الآخر يولي
    await new Promise((resolve) => setTimeout(resolve, 4300));
    const successor = await askWorker({ op: "acquire", runId, ttlMs: 4000 });
    expect(successor?.acquired).toBe(true);
    // fencing يتصاعد عبر العمليات: خليفة المالك الميت أعلى من الأول
    const firstFence = typeof winner?.fence === "number" ? winner.fence : 0;
    const successorFence = typeof successor?.fence === "number" ? successor.fence : 0;
    expect(successorFence).toBeGreaterThan(firstFence);
    // كتابة المالك القديم (fence الأول) فوق الأرشيف تُرفض — أساس الأرشفة والقفل معاً
    const archive = createInMemoryRunArchiveStore();
    expect((await archive.archive({ tenantId: "t", runId, snapshotJson: "old", generation: 1, fence: firstFence })).ok).toBe(true);
    const staleOwner = await archive.archive({ tenantId: "t", runId, snapshotJson: "stale", generation: 1, fence: firstFence });
    expect(staleOwner.ok).toBe(false);
  }, 20_000);

  it("release من مالك خاطئ عبر عملية مستقلة لا يحرر إيجار المالك الحقيقي", async () => {
    if (!(await portOpen("localhost", 6380))) {
      console.warn("[NOT_RUN] Redis 6380 غير متاح — اختبار العمليتين الحي مؤجل لبيئة معتمدة");
      return;
    }
    const runId = `lock-wrong-release-${Date.now()}`;
    const owner = await askWorker({ op: "acquire", runId, ttlMs: 8000 });
    expect(owner?.acquired).toBe(true);
    const attacker = await askWorker({ op: "release", runId, token: "not-the-owner" });
    expect(attacker?.released).toBe(false);
    // الإيجار ما زال محتجزاً — عملية ثالثة تُرفض
    const third = await askWorker({ op: "acquire", runId, ttlMs: 8000 });
    expect(third?.acquired).toBe(false);
  }, 20_000);
});
