/**
 * اختبارات عقد تذاكر HITL بالاتجاهين: موافقة صالحة
 * تُقبل وتُستهلك مرة واحدة، وكل شكل إساءة (عبث، مفتاح غريب، تغير
 * المخرجات، هوية مخالفة، تخويل مبطل، انتهاء، إعادة استخدام) يُرفض برمز موحد.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createInMemoryApprovalConsumedStore,
  digestOfSnapshot,
  generateHitlSigningMaterial,
  signHitlApproval,
  verifyHitlApproval,
  type HitlApprovalTicket,
} from "./hitl-approval.js";

const NOW = "2030-01-18T12:00:00.000Z";

function ticketOverrides(): Omit<HitlApprovalTicket, "version"> {
  const snapshotJson = JSON.stringify({ statuses: { evaluate: "needs_human" } });
  return {
    jti: "ticket-jti-0001",
    runId: "run-1",
    tenantId: "tenant-1",
    stage: "evaluate",
    snapshotDigest: digestOfSnapshot(snapshotJson),
    artifactDigest: "art-digest-1",
    approvedBy: "user:alice",
    authorizationVersion: 3,
    issuedAt: NOW,
    expiresAt: "2030-01-19T12:00:00.000Z",
  };
}

function validEnvelope(material = generateHitlSigningMaterial()): { json: string; material: typeof material } {
  return { json: signHitlApproval({ ticket: ticketOverrides(), material }), material };
}

function expectCode(result: { ok: boolean; error?: { code: string; message: string } }, code: string): void {
  expect(result.ok).toBe(false);
  expect(result.error?.code ?? result.error?.message ?? "").toContain(code);
}

describe("عقد HITL", () => {
  it("موافقة صالحة: تُقبل وتُستهلك مرة واحدة — إعادة الاستخدام APPROVAL_REUSED", async () => {
    const { json, material } = validEnvelope();
    const consumed = createInMemoryApprovalConsumedStore();
    const snapshotJson = JSON.stringify({ statuses: { evaluate: "needs_human" } });
    const input = {
      envelopeJson: json,
      keyRing: new Map([[material.keyId, material.publicKey]]),
      expected: {
        runId: "run-1",
        tenantId: "tenant-1",
        snapshotDigest: digestOfSnapshot(snapshotJson),
        artifactDigest: "art-digest-1",
        requesterSubjectId: "user:alice",
        currentAuthorizationVersion: 3,
        now: NOW,
      },
      consumed,
    };
    const first = await verifyHitlApproval(input);
    expect(first.ok).toBe(true);
    const second = await verifyHitlApproval(input);
    expectCode(second, "APPROVAL_REUSED");
  });

  it("عبث بالمحتوى بعد التوقيع — APPROVAL_BAD_SIGNATURE", async () => {
    const { json, material } = validEnvelope();
    const envelope = JSON.parse(json);
    envelope.ticket.stage = "certify"; // محاولة توجيه الموافقة لمرحلة أخرى
    const result = await verifyHitlApproval({
      envelopeJson: JSON.stringify(envelope),
      keyRing: new Map([[material.keyId, material.publicKey]]),
      expected: { runId: "run-1", tenantId: "tenant-1", snapshotDigest: ticketOverrides().snapshotDigest, artifactDigest: "art-digest-1", requesterSubjectId: "user:alice", currentAuthorizationVersion: 3, now: NOW },
      consumed: createInMemoryApprovalConsumedStore(),
    });
    expectCode(result, "APPROVAL_BAD_SIGNATURE");
  });

  it("مفتاح خارج حلقة الثقة — APPROVAL_UNKNOWN_KEY", async () => {
    const { json } = validEnvelope();
    const other = generateHitlSigningMaterial();
    const result = await verifyHitlApproval({
      envelopeJson: json,
      keyRing: new Map([[other.keyId, other.publicKey]]),
      expected: { runId: "run-1", tenantId: "tenant-1", snapshotDigest: ticketOverrides().snapshotDigest, artifactDigest: "art-digest-1", requesterSubjectId: "user:alice", currentAuthorizationVersion: 3, now: NOW },
      consumed: createInMemoryApprovalConsumedStore(),
    });
    expectCode(result, "APPROVAL_UNKNOWN_KEY");
  });

  it("تغير المخرجات بعد الموافقة (snapshot/artifact) — APPROVAL_STALE", async () => {
    const { json, material } = validEnvelope();
    const result = await verifyHitlApproval({
      envelopeJson: json,
      keyRing: new Map([[material.keyId, material.publicKey]]),
      expected: {
        runId: "run-1",
        tenantId: "tenant-1",
        snapshotDigest: digestOfSnapshot(JSON.stringify({ statuses: { evaluate: "needs_human" }, repairCyclesUsed: 2 })), // تغيرت
        artifactDigest: "art-digest-CHANGED",
        requesterSubjectId: "user:alice",
        currentAuthorizationVersion: 3,
        now: NOW,
      },
      consumed: createInMemoryApprovalConsumedStore(),
    });
    expectCode(result, "APPROVAL_STALE");
  });

  it("مقدم الطلب ليس هو الموافق — APPROVAL_IDENTITY", async () => {
    const { json, material } = validEnvelope();
    const result = await verifyHitlApproval({
      envelopeJson: json,
      keyRing: new Map([[material.keyId, material.publicKey]]),
      expected: { runId: "run-1", tenantId: "tenant-1", snapshotDigest: ticketOverrides().snapshotDigest, artifactDigest: "art-digest-1", requesterSubjectId: "user:mallory", currentAuthorizationVersion: 3, now: NOW },
      consumed: createInMemoryApprovalConsumedStore(),
    });
    expectCode(result, "APPROVAL_IDENTITY");
  });

  it("إبطال عضوية الموافق (إصدار تخويل انخفض) — APPROVAL_AUTHORIZATION_STALE", async () => {
    const { json, material } = validEnvelope();
    const result = await verifyHitlApproval({
      envelopeJson: json,
      keyRing: new Map([[material.keyId, material.publicKey]]),
      expected: { runId: "run-1", tenantId: "tenant-1", snapshotDigest: ticketOverrides().snapshotDigest, artifactDigest: "art-digest-1", requesterSubjectId: "user:alice", currentAuthorizationVersion: 2, now: NOW },
      consumed: createInMemoryApprovalConsumedStore(),
    });
    expectCode(result, "APPROVAL_AUTHORIZATION_STALE");
  });

  it("انتهاء الصلاحية — APPROVAL_EXPIRED", async () => {
    const { json, material } = validEnvelope();
    const result = await verifyHitlApproval({
      envelopeJson: json,
      keyRing: new Map([[material.keyId, material.publicKey]]),
      expected: { runId: "run-1", tenantId: "tenant-1", snapshotDigest: ticketOverrides().snapshotDigest, artifactDigest: "art-digest-1", requesterSubjectId: "user:alice", currentAuthorizationVersion: 3, now: "2030-01-20T00:00:00.000Z" },
      consumed: createInMemoryApprovalConsumedStore(),
    });
    expectCode(result, "APPROVAL_EXPIRED");
  });

  it("تشغيل/مستأجر آخر — APPROVAL_MISMATCH", async () => {
    const { json, material } = validEnvelope();
    const result = await verifyHitlApproval({
      envelopeJson: json,
      keyRing: new Map([[material.keyId, material.publicKey]]),
      expected: { runId: "run-OTHER", tenantId: "tenant-1", snapshotDigest: ticketOverrides().snapshotDigest, artifactDigest: "art-digest-1", requesterSubjectId: "user:alice", currentAuthorizationVersion: 3, now: NOW },
      consumed: createInMemoryApprovalConsumedStore(),
    });
    expectCode(result, "APPROVAL_MISMATCH");
  });

  it("digestOfSnapshot حتمي ومطابق sha256 المعياري", () => {
    const snapshot = "{\"a\":1}";
    expect(digestOfSnapshot(snapshot)).toBe(createHash("sha256").update(snapshot).digest("hex"));
  });
});
