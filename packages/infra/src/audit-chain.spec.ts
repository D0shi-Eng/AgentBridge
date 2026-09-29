/**
 * اختبارات سلسلة التدقيق — الربح الصحيح، الكشف عن العبث، انعزال المستأجرين.
 */
import { describe, expect, it } from "vitest";
import { createInMemorySemanticStore } from "@agentbridge/memory";
import type { AuditTrailEntry } from "@agentbridge/shared";
import { HashChainAuditLog, computeAuditHash, type AuditRecordInput } from "./audit-chain.js";

function inputOf(sequence: number): AuditRecordInput {
  return {
    tenantId: "tenant-a",
    runId: "run-1",
    stage: "harden",
    decision: sequence === 2 ? "needs_repair" : "completed",
    abstractedPayload: `قرار ${sequence} بلا أي بيانات خام`,
    at: `2026-08-24T00:00:0${sequence}Z`,
  };
}

describe("HashChainAuditLog", () => {
  it("يربط كل صف بذيل السلسلة: seq تصاعدي وprevHash موصول وhash محسوب", async () => {
    const sink = createInMemorySemanticStore();
    const audit = new HashChainAuditLog(sink);

    const first = await audit.record(inputOf(1));
    const second = await audit.record(inputOf(2));

    expect(first.seq).toBe(1);
    expect(first.prevHash).toBe("0".repeat(64));
    expect(second.prevHash).toBe(first.hash);
    expect(second.seq).toBe(2);
  });

  it("verifyChain ينجح على سلسلة كاملة ويعيد عدد الصفوف", async () => {
    const sink = createInMemorySemanticStore();
    const audit = new HashChainAuditLog(sink);
    for (const index of [1, 2, 3]) await audit.record(inputOf(index));

    const result = await audit.verifyChain("tenant-a");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.entries).toBe(3);
  });

  it("زرع عبث في صف واحد يكسر التحقق عند موضعه", async () => {
    const sink = createInMemorySemanticStore();
    const audit = new HashChainAuditLog(sink);
    for (const index of [1, 2, 3]) await audit.record(inputOf(index));

    const entries = await sink.listAuditEntries("tenant-a");
    const tampered = entries.map((entry, index) =>
      index === 1 ? { ...entry, abstractedPayload: "عبث لاحق" } : entry,
    );

    const freshSink = createInMemorySemanticStore();
    for (const entry of tampered) await freshSink.appendAuditEntry(entry);

    const result = await new HashChainAuditLog(freshSink).verifyChain("tenant-a");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("مكسورة");
    expect(result.error.message).toContain("2");
  });

  it("تغيير hash نفسه أو تسلسل seq يكشف أيضاً", async () => {
    const buildWith = async (
      mutate: (entries: AuditTrailEntry[]) => AuditTrailEntry[],
    ): Promise<Awaited<ReturnType<HashChainAuditLog["verifyChain"]>>> => {
      const store = createInMemorySemanticStore();
      const audit = new HashChainAuditLog(store);
      for (const index of [1, 2]) await audit.record(inputOf(index));
      const mutated = mutate([...(await store.listAuditEntries("tenant-a"))]);
      const fresh = createInMemorySemanticStore();
      for (const entry of mutated) await fresh.appendAuditEntry(entry);
      return new HashChainAuditLog(fresh).verifyChain("tenant-a");
    };

    const flippedHash = await buildWith((entries) =>
      entries.map((entry, index) => (index === 0 ? { ...entry, hash: "f".repeat(64) } : entry)),
    );
    expect(flippedHash.ok).toBe(false);

    const shuffledSeq = await buildWith((entries) => [...entries].reverse());
    expect(shuffledSeq.ok).toBe(false);
  });

  it("سلاسل المستأجرين مستقلة تماماً", async () => {
    const sink = createInMemorySemanticStore();
    const audit = new HashChainAuditLog(sink);
    await audit.record(inputOf(1));
    await audit.record({ ...inputOf(1), tenantId: "tenant-b", runId: "run-b" });

    expect((await audit.verifyChain("tenant-a")).ok).toBe(true);
    expect((await audit.verifyChain("tenant-b")).ok).toBe(true);
    expect(await audit.verifyChain("tenant-c")).toMatchObject({ ok: true, value: { entries: 0 } });
  });

  it("صف غير مطابق لمخطط AuditTrailEntry يرفض قبل إعادة الحساب", async () => {
    const sink = createInMemorySemanticStore();
    await sink.appendAuditEntry({
      ...inputOf(1),
      seq: 1,
      prevHash: "0".repeat(64),
      hash: computeAuditHash({
        ...inputOf(1),
        seq: 1,
        prevHash: "0".repeat(64),
        hash: "",
      }),
    } as never);

    // حقل stage خارج قائمة المراحل = بنية فاسدة
    const bad = { ...(await sink.listAuditEntries("tenant-a"))[0], stage: "not-a-stage" };
    const fresh = createInMemorySemanticStore();
    await fresh.appendAuditEntry(bad as never);

    const result = await new HashChainAuditLog(fresh).verifyChain("tenant-a");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain("غير سليم البنية");
  });
});
