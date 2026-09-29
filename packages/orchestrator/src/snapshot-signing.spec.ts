/**
 * اختبارات مصادقة snapshots.
 * كل حالة إيجابية وسلبية من عقد وثيقة 05: التوقيع، المفتاح، الصلاحية،
 * الهوية، التخويل، السياسة، replay، والهجرة المصدرحة للـlegacy.
 */

import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import {
  canonicalJson,
  classifySnapshot,
  generateSnapshotSigningMaterial,
  loadSnapshotSigningMaterial,
  migrateLegacySnapshot,
  signSnapshot,
  SNAPSHOT_POLICY_VERSION,
  verifySignedSnapshot,
  type SnapshotBodyFields,
} from "./snapshot-signing.js";
import { PipelineContext } from "./context-store.js";

function samplePayload(): SnapshotBodyFields {
  return {
    version: 1,
    runId: "run-1",
    tenantId: "tenant-1",
    createdAt: "2030-06-18T00:00:00.000Z",
    statuses: { load_spec: "completed", normalize: "pending" },
    repairCyclesUsed: 1,
    data: { rawSpec: "openapi: 3.0.0" },
  };
}

function baseFacts() {
  return {
    runId: "run-1",
    tenantId: "tenant-1",
    createdAt: "2030-06-18T00:00:00.000Z",
    generation: 3,
    policyVersion: SNAPSHOT_POLICY_VERSION,
    resumeBinding: { allowedSubjects: [], minAuthorizationVersion: 1 },
    inputDigests: { rawSpecSha256: createHash("sha256").update("openapi: 3.0.0").digest("hex") },
  };
}

const SIGN_NOW = "2030-06-18T00:30:00.000Z";
function baseExpectations() {
  return { runId: "run-1", tenantId: "tenant-1", now: "2030-06-18T01:00:00.000Z" };
}

describe("canonicalJson", () => {
  it("حتمي: ترتيب المفاتيح لا يغير النص، والمصفوفات بترتيبها", () => {
    const a = canonicalJson({ b: 1, a: { d: [3, 2], c: true } });
    const b = canonicalJson({ a: { c: true, d: [3, 2] }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"c":true,"d":[3,2]},"b":1}');
  });
});

describe("signSnapshot/verifySignedSnapshot — بوابة التوقيع", () => {
  it("توقيع ثم تحقق ناجح يعيد الحقائق والمحتوى", () => {
    const material = generateSnapshotSigningMaterial();
    const json = signSnapshot({ facts: baseFacts(), payload: samplePayload(), material, now: SIGN_NOW });
    expect(classifySnapshot(json)).toBe("signed");
    const verified = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), baseExpectations());
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.facts.generation).toBe(3);
      expect(verified.value.payload.repairCyclesUsed).toBe(1);
    }
  });

  it("تعديل المحتوى بعد التوقيع يكسر التوقيع — SNAPSHOT_BAD_SIGNATURE", () => {
    const material = generateSnapshotSigningMaterial();
    const json = signSnapshot({ facts: baseFacts(), payload: samplePayload(), material, now: SIGN_NOW });
    const parsed = JSON.parse(json);
    parsed.payload.repairCyclesUsed = 99;
    const verified = verifySignedSnapshot(JSON.stringify(parsed), new Map([[material.keyId, material.publicKey]]), baseExpectations());
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("SNAPSHOT_BAD_SIGNATURE");
  });

  it("مفتاح غريب عن حلقة الثقة — SNAPSHOT_UNKNOWN_KEY", () => {
    const signer = generateSnapshotSigningMaterial();
    const other = generateSnapshotSigningMaterial();
    const json = signSnapshot({ facts: baseFacts(), payload: samplePayload(), material: signer, now: SIGN_NOW });
    const verified = verifySignedSnapshot(json, new Map([[other.keyId, other.publicKey]]), baseExpectations());
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("SNAPSHOT_UNKNOWN_KEY");
  });

  it("توقيع ناقص أو شكل فاسد — SNAPSHOT_MALFORMED", () => {
    const material = generateSnapshotSigningMaterial();
    const parsed = JSON.parse(signSnapshot({ facts: baseFacts(), payload: samplePayload(), material, now: SIGN_NOW }));
    delete parsed.auth;
    const verified = verifySignedSnapshot(JSON.stringify(parsed), new Map([[material.keyId, material.publicKey]]), baseExpectations());
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("SNAPSHOT_MALFORMED");
  });

  it("إصدار غير مدعوم — SNAPSHOT_UNSUPPORTED_VERSION", () => {
    const verified = verifySignedSnapshot("{\"snapshotVersion\":99}", new Map(), baseExpectations());
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("SNAPSHOT_UNSUPPORTED_VERSION");
  });

  it("انتهاء الصلاحية وفق السياسة — SNAPSHOT_EXPIRED", () => {
    const material = generateSnapshotSigningMaterial();
    const json = signSnapshot({ facts: baseFacts(), payload: samplePayload(), material, now: "2030-06-01T00:00:00.000Z", ttlMs: 1000 });
    const verified = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), baseExpectations());
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("SNAPSHOT_EXPIRED");
  });

  it("replay بجيل أقدم من المعتمد — SNAPSHOT_REPLAY", () => {
    const material = generateSnapshotSigningMaterial();
    const json = signSnapshot({ facts: baseFacts(), payload: samplePayload(), material, now: SIGN_NOW });
    const verified = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), { ...baseExpectations(), minGeneration: 4 });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("SNAPSHOT_REPLAY");
  });

  it("تحميل مفتاح PKCS8 base64 يعيد نفس keyId ويرفض غير Ed25519", () => {
    const material = generateSnapshotSigningMaterial();
    const pkcs8 = Buffer.from(material.privateKey.export({ type: "pkcs8", format: "der" })).toString("base64");
    const loaded = loadSnapshotSigningMaterial(pkcs8);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.keyId).toBe(material.keyId);
    const bad = loadSnapshotSigningMaterial(Buffer.from("not-a-key").toString("base64"));
    expect(bad.ok).toBe(false);
  });
});

describe("ربط الهوية عند الاستئناف", () => {
  it("runId أو tenantId مخالف — SNAPSHOT_IDENTITY_MISMATCH (الاستئناف العابر مستحيل)", () => {
    const material = generateSnapshotSigningMaterial();
    const json = signSnapshot({ facts: baseFacts(), payload: samplePayload(), material, now: SIGN_NOW });
    const wrongRun = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), { ...baseExpectations(), runId: "run-OTHER" });
    const wrongTenant = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), { ...baseExpectations(), tenantId: "tenant-B" });
    expect(wrongRun.ok).toBe(false);
    expect(wrongTenant.ok).toBe(false);
    if (!wrongRun.ok) expect(wrongRun.error.code).toBe("SNAPSHOT_IDENTITY_MISMATCH");
    if (!wrongTenant.ok) expect(wrongTenant.error.code).toBe("SNAPSHOT_IDENTITY_MISMATCH");
  });

  it("مُستأنف خارج قائمة التخويل — SNAPSHOT_RESUMER_NOT_ALLOWED، ومن داخلها يمر", () => {
    const material = generateSnapshotSigningMaterial();
    const facts = { ...baseFacts(), resumeBinding: { allowedSubjects: ["user:alice"], minAuthorizationVersion: 1 } };
    const json = signSnapshot({ facts, payload: samplePayload(), material, now: SIGN_NOW });
    const denied = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), { ...baseExpectations(), resumerSubject: "user:mallory" });
    const allowed = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), { ...baseExpectations(), resumerSubject: "user:alice" });
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("SNAPSHOT_RESUMER_NOT_ALLOWED");
    expect(allowed.ok).toBe(true);
  });

  it("إبطال العضوية (إصدار تخويل أدنى) يمنع استعادة الحالة — SNAPSHOT_AUTHORIZATION_STALE", () => {
    const material = generateSnapshotSigningMaterial();
    const facts = { ...baseFacts(), resumeBinding: { allowedSubjects: ["user:alice"], minAuthorizationVersion: 5 } };
    const json = signSnapshot({ facts, payload: samplePayload(), material, now: SIGN_NOW });
    const stale = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), { ...baseExpectations(), resumerSubject: "user:alice", authorizationVersion: 4 });
    const fresh = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), { ...baseExpectations(), resumerSubject: "user:alice", authorizationVersion: 5 });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error.code).toBe("SNAPSHOT_AUTHORIZATION_STALE");
    expect(fresh.ok).toBe(true);
  });

  it("سياسة غير مدعومة — SNAPSHOT_POLICY_UNSUPPORTED", () => {
    const material = generateSnapshotSigningMaterial();
    const facts = { ...baseFacts(), policyVersion: "ancient-policy" };
    const json = signSnapshot({ facts, payload: samplePayload(), material, now: SIGN_NOW });
    const verified = verifySignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), baseExpectations());
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("SNAPSHOT_POLICY_UNSUPPORTED");
  });
});

describe("حجر legacy والهجرة المصدرحة", () => {
  function legacyJson(): string {
    const context = new PipelineContext("run-1", "tenant-1");
    context.data.rawSpec = "openapi: 3.0.0";
    return context.toSnapshot();
  }

  it("الإصدار 1 يُصنف legacy — لا يمر بوابات التحقق الموقعة", () => {
    expect(classifySnapshot(legacyJson())).toBe("legacy");
    const verified = verifySignedSnapshot(legacyJson(), new Map(), baseExpectations());
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.error.code).toBe("SNAPSHOT_UNSUPPORTED_VERSION");
  });

  it("هجرة مصرحة: توقيع جديد بعلامة migratedFrom وجيل جديد يمر التحقق", () => {
    const material = generateSnapshotSigningMaterial();
    const legacy = JSON.parse(legacyJson());
    const migrated = migrateLegacySnapshot({
      legacyJson: legacyJson(),
      material,
      authorizedBy: "ops:reviewer-1",
      generation: 100,
      body: legacy,
      resumeBinding: { allowedSubjects: [], minAuthorizationVersion: 1 },
      now: "2030-06-18T02:00:00.000Z",
    });
    expect(migrated.ok).toBe(true);
    if (!migrated.ok) return;
    expect(classifySnapshot(migrated.value)).toBe("signed");
    const verified = verifySignedSnapshot(migrated.value, new Map([[material.keyId, material.publicKey]]), baseExpectations());
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.value.facts.migratedFrom).toBe(1);
      expect(verified.value.facts.inputDigests["migratedBy"]).toBe("ops:reviewer-1");
      expect(verified.value.facts.generation).toBe(100);
    }
  });

  it("legacy معدلة بعد حقاقتها القديمة تُرفض من الهجرة — لا توقيع عبث", () => {
    const material = generateSnapshotSigningMaterial();
    const tampered = JSON.parse(legacyJson());
    tampered.repairCyclesUsed = 77;
    const rejected = migrateLegacySnapshot({
      legacyJson: JSON.stringify(tampered),
      material,
      authorizedBy: "ops:reviewer-1",
      generation: 100,
      body: tampered,
      resumeBinding: { allowedSubjects: [], minAuthorizationVersion: 1 },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.error.code).toBe("SNAPSHOT_LEGACY_MIGRATION_INVALID");
  });
});

describe("PipelineContext فوق المظروف الموقّع", () => {
  it("toSignedSnapshot ثم fromSignedSnapshot يعيدان الحالة بجيل متصاعد", () => {
    const material = generateSnapshotSigningMaterial();
    const context = new PipelineContext("run-1", "tenant-1");
    context.data.rawSpec = "openapi: 3.0.0";
    context.statuses.set("load_spec", "completed");
    context.repairCyclesUsed = 2;
    const envelope = context.toSignedSnapshot({
      material,
      resumeBinding: { allowedSubjects: [], minAuthorizationVersion: 1 },
      inputDigests: {},
    });
    expect(context.generation).toBe(1);
    const restored = PipelineContext.fromSignedSnapshot(
      envelope,
      new Map([[material.keyId, material.publicKey]]),
      { runId: "run-1", tenantId: "tenant-1" },
    );
    expect(restored.ok).toBe(true);
    if (!restored.ok) return;
    expect(restored.value.data.rawSpec).toBe("openapi: 3.0.0");
    expect(restored.value.repairCyclesUsed).toBe(2);
    expect(restored.value.statuses.get("load_spec")).toBe("completed");
    expect(restored.value.generation).toBe(1);
    // الجيل التالي أعلى — أساس حرس replay في الأرشيف الدائم
    context.toSignedSnapshot({ material, resumeBinding: { allowedSubjects: [], minAuthorizationVersion: 1 }, inputDigests: {} });
    expect(context.generation).toBe(2);
  });

  it("حقل data غير معروف داخل payload موقعة يُرفض رغم صحة التوقيع", () => {
    const material = generateSnapshotSigningMaterial();
    const payload = { ...samplePayload(), data: { smuggled: "nope" } };
    const json = signSnapshot({ facts: baseFacts(), payload, material, now: SIGN_NOW });
    const restored = PipelineContext.fromSignedSnapshot(json, new Map([[material.keyId, material.publicKey]]), baseExpectations());
    expect(restored.ok).toBe(false);
    if (!restored.ok) expect(restored.error.code).toBe("INVALID_INPUT");
  });
});
