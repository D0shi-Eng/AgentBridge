/**
 * اختبارات محولات دورة الحياة داخل الذاكرة — ملكية الوحدة: كل
 * محول في memory يختبر هنا مباشرة، لا عبر اختبارات infra البعيدة.
 */

import { describe, expect, it } from "vitest";
import { createInMemoryAuthStore, createInMemorySemanticStore } from "./index.js";

const NOW = "2026-09-20T12:00:00.000Z";

describe("FC — عمليات الجانب الدلالي داخل الذاكرة", () => {
  it("تعداد المسؤولين وحالة دورة الحياة والقبر والحجز", async () => {
    const semantic = createInMemorySemanticStore();
    await semantic.createTenant({ tenantId: "t1", name: "أول", apiKeyHash: "h1", isAdmin: true, createdAt: NOW });
    await semantic.createTenant({ tenantId: "t2", name: "ثانٍ", apiKeyHash: "h2", createdAt: NOW });
    expect(await semantic.countAdminTenants()).toBe(1);
    expect(await semantic.getTenantLifecycleState("t2")).toEqual({});
    expect(await semantic.getTenantLifecycleState("ghost")).toBeNull();
    await semantic.setTenantLegalHold("t2", "2099-01-01T00:00:00.000Z");
    expect((await semantic.getTenantLifecycleState("t2"))?.legalHoldUntil).toBe("2099-01-01T00:00:00.000Z");
    await semantic.setTenantLegalHold("t2", null);
    expect((await semantic.getTenantLifecycleState("t2"))?.legalHoldUntil).toBeUndefined();
    await semantic.tombstoneTenant("t2", NOW);
    expect((await semantic.getTenantLifecycleState("t2"))?.deletedAt).toBe(NOW);
    await expect(semantic.setTenantLegalHold("ghost", NOW)).rejects.toThrow("غير موجود");
    await expect(semantic.tombstoneTenant("ghost", NOW)).rejects.toThrow("غير موجود");
  });

  it("تعداد الأثر والمسح يحترمان العزل ويحفظان الإبطالات والتدقيق", async () => {
    const semantic = createInMemorySemanticStore();
    await semantic.createProject({ projectId: "p1", tenantId: "t1", name: "أ", createdAt: NOW });
    await semantic.createProject({ projectId: "bp1", tenantId: "t2", name: "ب", createdAt: NOW });
    await semantic.createSpec({ specId: "s1", tenantId: "t1", projectId: "p1", content: "x", createdAt: NOW });
    await semantic.upsertPipeline({ runId: "r1", tenantId: "t1", projectId: "p1", specId: "s1", status: "completed", repairCyclesUsed: 0, createdAt: NOW, updatedAt: NOW });
    await semantic.saveCertificate({ runId: "r1", tenantId: "t1", finalScore: 90, granted: true, verificationId: "ver-1", certificateJson: "{}", issuedAt: NOW });
    await semantic.saveArtifact({ runId: "r1", tenantId: "t1", artifactJson: "{}", createdAt: NOW });
    await semantic.revokeCertificate({ tenantId: "t1", runId: "r1", verificationId: "ver-1", reason: "سبب", revokedAt: NOW });
    await semantic.appendAuditEntry({ seq: 1, tenantId: "t1", runId: "r1", stage: "certify", decision: "granted", abstractedPayload: "{}", at: NOW, prevHash: "0".repeat(64), hash: "a".repeat(64) });

    const impact = await semantic.countSemanticImpact("t1");
    expect(impact).toEqual({ projects: 1, specs: 1, pipelines: 1, certificates: 1, artifacts: 1, revocationsKept: 1, auditKept: 1 });
    const purged = await semantic.purgeSemanticData("t1");
    expect(purged).toEqual({ projects: 1, specs: 1, pipelines: 1, certificates: 1, artifacts: 1 });
    // المستأجر الآخر سليم والإبطال والتدقيق باقيان
    expect(await semantic.getProject("t2", "bp1")).not.toBeNull();
    expect((await semantic.getRevocationByVerificationId("ver-1"))?.verificationId).toBe("ver-1");
    expect((await semantic.listAuditEntries("t1"))).toHaveLength(1);
    expect(await semantic.listRevocationVerificationIds("t1")).toEqual(["ver-1"]);
  });

  it("مسح الحزم المنتهية حسب createdAt", async () => {
    const semantic = createInMemorySemanticStore();
    await semantic.saveArtifact({ runId: "old", tenantId: "t1", artifactJson: "{}", createdAt: "2026-06-01T00:00:00.000Z" });
    await semantic.saveArtifact({ runId: "new", tenantId: "t1", artifactJson: "{}", createdAt: NOW });
    expect(await semantic.purgeExpiredArtifacts("t1", "2026-09-01T00:00:00.000Z")).toBe(1);
    expect(await semantic.getArtifact("t1", "old")).toBeNull();
    expect(await semantic.getArtifact("t1", "new")).not.toBeNull();
  });
});

describe("FC — عمليات الجانب الأمني داخل الذاكرة", () => {
  it("تعطيل الوصول وإلغاء الاعتمادات والجلسات بنطاق المستأجر", async () => {
    const auth = createInMemoryAuthStore();
    await auth.putApiCredential({ credentialId: "c-t1", tenantId: "t1", subjectId: "s1", keyHash: "h", permissions: ["resource:read"], authorizationVersion: 1 });
    await auth.putApiCredential({ credentialId: "c-t2", tenantId: "t2", subjectId: "s2", keyHash: "h", permissions: ["resource:read"], authorizationVersion: 1 });
    await auth.putSession({ sessionId: "s-old", tokenHash: "tok", csrfHash: "c", browserBindingHash: "b", identityId: "i", authMethod: "oidc", membershipId: "m", tenantId: "t1", permissions: ["resource:read"], authorizationVersion: 1, idleExpiresAt: NOW, absoluteExpiresAt: NOW });
    const impact = await auth.countAuthImpact("t1");
    expect(impact).toEqual({ credentialsRevoked: 1, sessionsRevoked: 1 });
    const revoked = await auth.revokeTenantAuth("t1", NOW);
    expect(revoked).toEqual({ credentialsRevoked: 1, sessionsRevoked: 1 });
    expect((await auth.findApiCredential("c-t1"))?.revokedAt).toBe(NOW);
    expect((await auth.findApiCredential("c-t2"))?.revokedAt).toBeUndefined();
    // إعادة الإلغاء idempotent — صفر إضافي
    expect(await auth.revokeTenantAuth("t1", NOW)).toEqual({ credentialsRevoked: 0, sessionsRevoked: 0 });
    expect(await auth.deleteTenantCredentials("t1")).toBe(1);
    expect(await auth.findApiCredential("c-t1")).toBeNull();
  });

  it("مسح الجلسات المنتهية ومعاملات الدخول بحدود الاحتفاظ", async () => {
    const auth = createInMemoryAuthStore();
    await auth.putSession({ sessionId: "s1", tokenHash: "tok1", csrfHash: "c", browserBindingHash: "b", identityId: "i", authMethod: "oidc", membershipId: "m", tenantId: "t1", permissions: [], authorizationVersion: 1, idleExpiresAt: NOW, absoluteExpiresAt: "2026-06-01T00:00:00.000Z" });
    await auth.putSession({ sessionId: "s2", tokenHash: "tok2", csrfHash: "c", browserBindingHash: "b", identityId: "i", authMethod: "oidc", membershipId: "m", tenantId: "t1", permissions: [], authorizationVersion: 1, idleExpiresAt: NOW, absoluteExpiresAt: "2027-06-01T00:00:00.000Z" });
    await auth.putLoginTransaction({ transactionId: "tx1", stateHash: "st1", browserBindingHash: "b", tenantId: "t1", configVersion: 1, configInstanceId: "ci", nonce: "n", verifierEnvelope: "v", redirectUri: "https://x.test/cb", returnPath: "/", expiresAt: "2026-06-01T00:00:00.000Z" });
    // مستهلك قديماً (قبل cutoff) — يُحذف؛ المستهلك عند cutoff نفسها يبقى
    await auth.putLoginTransaction({ transactionId: "tx2", stateHash: "st2", browserBindingHash: "b", tenantId: "t1", configVersion: 1, configInstanceId: "ci", nonce: "n", verifierEnvelope: "v", redirectUri: "https://x.test/cb", returnPath: "/", expiresAt: "2027-06-01T00:00:00.000Z", consumedAt: "2026-01-01T00:00:00.000Z" });
    await auth.putLoginTransaction({ transactionId: "tx3", stateHash: "st3", browserBindingHash: "b", tenantId: "t1", configVersion: 1, configInstanceId: "ci", nonce: "n", verifierEnvelope: "v", redirectUri: "https://x.test/cb", returnPath: "/", expiresAt: "2027-06-01T00:00:00.000Z", consumedAt: NOW });
    expect(await auth.purgeExpiredSessions("t1", NOW)).toBe(1);
    expect(await auth.purgeExpiredLoginTransactions("t1", NOW)).toBe(2);
    expect(await auth.findSessionByHash("tok1")).toBeNull();
    expect(await auth.findSessionByHash("tok2")).not.toBeNull();
    // tx3 مستهلك عند NOW — بقاءه إلزامي مهما انتهت صلاحيته الظاهرة
    expect(await auth.purgeExpiredLoginTransactions("t1", "2026-06-01T00:00:00.000Z")).toBe(0);
  });
});
