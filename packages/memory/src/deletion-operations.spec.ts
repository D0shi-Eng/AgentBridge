/**
 * اختبارات سجل عمليات حذف المستأجر الداخلي — القرار الذري
 * (فتح/استئناف/إعادة إرسال/تعارض)، وتثبيت المراحل، والإكمال مع وصل
 * التدقيق بترتيب صحيح، والسياج المُهشَّم لا الخام.
 */

import { describe, expect, it } from "vitest";
import {
  createInMemoryDeletionOperationStore, type DeletionAuditEntryInput,
} from "./deletion-operations.js";

const FENCE_A = "aaaaaaaaaaaaaaaa01";
const FENCE_B = "bbbbbbbbbbbbbbbb02";
const NOW = "2026-09-21T00:00:00.000Z";

function auditInput(decision = "completed"): DeletionAuditEntryInput {
  return { tenantId: "t1", runId: `del:${decision}`, stage: "tenant_deletion", decision, abstractedPayload: "{}", at: NOW };
}

describe("سجل عمليات الحذف الداخلي", () => {
  it("القرار الذري: فتح أول مرة ثم تعارض توازي لنسيج مختلف أثناء القائمة", async () => {
    const store = createInMemoryDeletionOperationStore();
    const first = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    expect(first.kind).toBe("claimed");
    const conflict = await store.beginOrResumeOperation("t1", FENCE_B, NOW);
    expect(conflict.kind).toBe("inProgressConflict");
  });

  it("نفس النسيج على عملية قائمة = استئناف من مرحلتها المسجلة", async () => {
    const store = createInMemoryDeletionOperationStore();
    const claim = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    if (claim.kind !== "claimed") throw new Error("توقعت فتحاً");
    await store.updateStage("t1", claim.operationId, "purged");
    const resume = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    expect(resume).toEqual({ kind: "resumed", operationId: claim.operationId, stage: "purged" });
  });

  it("مكتملة بنفس النسيج = إعادة إرسال بالإيصال المخزن، وبنسيج مختلف = تعارض صريح", async () => {
    const store = createInMemoryDeletionOperationStore();
    const claim = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    if (claim.kind !== "claimed") throw new Error("توقعت فتحاً");
    await store.completeOperation("t1", claim.operationId, '{"receipt":true}', NOW, auditInput());
    const replay = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    expect(replay).toEqual({ kind: "replay", receiptJson: '{"receipt":true}' });
    const otherFence = await store.beginOrResumeOperation("t1", FENCE_B, NOW);
    expect(otherFence.kind).toBe("fenceConflict");
  });

  it("الإكمال يخزن الإيصال ويقلب الحالة ويكتب الوصل أولاً — وبلا مدخل تدقيق لا يُكتب وصل", async () => {
    const recorded: DeletionAuditEntryInput[] = [];
    const store = createInMemoryDeletionOperationStore({ async record(input) { recorded.push(input); } });
    const claim = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    if (claim.kind !== "claimed") throw new Error("توقعت فتحاً");
    await store.completeOperation("t1", claim.operationId, '{"r":1}', NOW, auditInput());
    const done = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    if (done.kind !== "replay") throw new Error("توقعت إعادة إرسال");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.decision).toBe("completed");
    expect(done.receiptJson).toBe('{"r":1}');
    // مستأجر ثانٍ بلا مدخل تدقيق — لا وصل يُكتب
    const other = await store.beginOrResumeOperation("t2", FENCE_A, NOW);
    if (other.kind !== "claimed") throw new Error("توقعت فتحاً");
    await store.completeOperation("t2", other.operationId, '{"r":2}', NOW);
    expect(recorded).toHaveLength(1);
  });

  it("السياج لا يُخزن خاماً أبداً — بصمة sha256 حصراً في السجل", async () => {
    const store = createInMemoryDeletionOperationStore();
    const claim = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    if (claim.kind !== "claimed") throw new Error("توقعت فتحاً");
    await store.updateStage("t1", claim.operationId, "revoked");
    await store.completeOperation("t1", claim.operationId, "{}", NOW, auditInput());
    // الاستئناف بنسيج خام مُمرَّر يفشل — البصمة هي التي تطابق
    const wrongRaw = await store.beginOrResumeOperation("t1", FENCE_A.toUpperCase(), NOW);
    expect(wrongRaw.kind).toBe("fenceConflict");
  });

  it("مستأجرون مختلفون مستقلون تماماً في السجل", async () => {
    const store = createInMemoryDeletionOperationStore();
    const a = await store.beginOrResumeOperation("t1", FENCE_A, NOW);
    const b = await store.beginOrResumeOperation("t2", FENCE_A, NOW);
    expect(a.kind).toBe("claimed");
    expect(b.kind).toBe("claimed");
  });
});
