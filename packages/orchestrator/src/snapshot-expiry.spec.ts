/**
 * اختبارات الانقضاء الثلاثي المنفصل: cache TTL ≠ صلاحية
 * snapshot الموقعة ≠ نافذة الاستئناف.
 *
 * تثبت: (1) صلاحية snapshot تنقضي بالزمن المنطقي المحقون (لا بحذف
 * المخزن) برفض SNAPSHOT_EXPIRED؛ (2) لا تمديد صامت — expiresAt موقعة
 * ضمن facts فأي تلاعب يكسر التحقق كلياً؛ (3) replay guard بالجيل يمنع
 * إرجاع إصدار أقدم ولو كانت صلاحيته قائمة؛ (4) snapshot حاضرة في
 * المخزن قد تكون منتهية — الحاضرة ليست المصرّحة (فصل cache عن الصلاحية).
 */

import { describe, expect, it } from "vitest";
import {
  generateSnapshotSigningMaterial,
  PipelineContext,
  verifySignedSnapshot,
  SNAPSHOT_POLICY_VERSION,
  SNAPSHOT_TTL_MS_DEFAULT,
} from "../src/index.js";

const material = generateSnapshotSigningMaterial();
const ring = new Map([[material.keyId, material.publicKey]]);
const binding = { allowedSubjects: [], minAuthorizationVersion: 0 };

/** يبني سياقاً جديداً — toSignedSnapshot يزيد الجيل داخلياً مع كل حفظ */
function freshContext(): PipelineContext {
  return new PipelineContext("run-exp", "tenant-exp");
}

describe("صلاحية snapshot الموقعة بساعة محقونة", () => {
  it("قبل الانقضاء تُقبل، وبعده تُرفض SNAPSHOT_EXPIRED — بلا مساس المخزن", () => {
    const issued = "2030-03-10T00:00:00.000Z";
    const envelope = freshContext().toSignedSnapshot({
      material, resumeBinding: binding, inputDigests: {}, now: issued,
    });

    const early = verifySignedSnapshot(envelope, ring, {
      policyVersion: undefined,
      now: "2030-03-10T01:00:00.000Z",
    });
    expect(early.ok).toBe(true);

    const late = verifySignedSnapshot(envelope, ring, {
      policyVersion: undefined,
      now: new Date(Date.parse(issued) + SNAPSHOT_TTL_MS_DEFAULT + 3_600_000).toISOString(),
    });
    expect(late.ok).toBe(false);
    if (!late.ok) expect(late.error.code).toBe("SNAPSHOT_EXPIRED");
  });

  it("لا تمديد صامت: expiresAt موقعة — تعديلها بعد التوقيع يكسر التحقق", () => {
    const envelope = freshContext().toSignedSnapshot({
      material, resumeBinding: binding, inputDigests: {}, now: "2030-03-10T00:00:00.000Z",
    });
    // مهاجم يمدد الصلاحية ويبقي التوقيع القديم كما هو
    const forged = JSON.parse(envelope) as { facts: { expiresAt: string } };
    forged.facts.expiresAt = "2099-01-01T00:00:00.000Z";
    const verdict = verifySignedSnapshot(JSON.stringify(forged), ring, {
      policyVersion: undefined,
      now: "2030-03-11T00:00:00.000Z",
    });
    expect(verdict.ok).toBe(false);
  });

  it("replay guard: جيل أقدم يُرفض ولو كانت صلاحيته قائمة", () => {
    // نفس السياق بحفظين — الجيل يتصاعد 1 ثم 2
    const ctx = freshContext();
    const first = ctx.toSignedSnapshot({ material, resumeBinding: binding, inputDigests: {}, now: "2030-03-12T00:00:00.000Z" });
    const second = ctx.toSignedSnapshot({ material, resumeBinding: binding, inputDigests: {}, now: "2030-03-12T00:05:00.000Z" });

    const accepted = verifySignedSnapshot(second, ring, {
      policyVersion: SNAPSHOT_POLICY_VERSION,
      now: "2030-03-12T01:00:00.000Z",
      minGeneration: 2,
    });
    expect(accepted.ok).toBe(true);

    const replayed = verifySignedSnapshot(first, ring, {
      policyVersion: SNAPSHOT_POLICY_VERSION,
      now: "2030-03-12T01:00:00.000Z",
      minGeneration: 2,
    });
    expect(replayed.ok).toBe(false);
    if (!replayed.ok) expect(replayed.error.code).toBe("SNAPSHOT_REPLAY");
  });

  it("نافذة قصيرة صريحة بـttlMs — نافذة الاستئناف سياسة معلنة لا ثابت مخفي", () => {
    const issued = Date.parse("2030-03-10T00:00:00.000Z");
    const oneHour = freshContext().toSignedSnapshot({
      material, resumeBinding: binding, inputDigests: {},
      now: new Date(issued).toISOString(), ttlMs: 3_600_000,
    });
    const within = verifySignedSnapshot(oneHour, ring, {
      policyVersion: undefined,
      now: new Date(issued + 3_000_000).toISOString(),
    });
    const after = verifySignedSnapshot(oneHour, ring, {
      policyVersion: undefined,
      now: new Date(issued + 3_900_000).toISOString(),
    });
    expect(within.ok).toBe(true);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error.code).toBe("SNAPSHOT_EXPIRED");
  });
});
