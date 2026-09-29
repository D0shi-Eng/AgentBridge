/**
 * اختبارات الاحتفاظ القابلة للتنفيذ — مخطط السياسة الصارم، ومسح
 * المنتهي قبل/بعد، والعزل بين المستأجرين، والـidempotency، وحماية
 * إبطالات الشهادات المنشورة، وتوثيق الأوضاع المعلنة بصدق.
 */

import { describe, expect, it } from "vitest";
import {
  createInMemoryAuthStore, createInMemoryRunArchiveStore, createInMemorySemanticStore,
  type TenantLifecycleStore,
} from "@agentbridge/memory";
import { DEV_RETENTION_POLICY, RetentionPolicySchema } from "./retention-policy.js";
import { runRetentionSweep, type RetentionSweepPort } from "./retention-sweeper.js";

const NOW = "2026-09-20T12:00:00.000Z";

/** سياسة اختبار اصطناعية قصيرة — قيم تجريبية لا defaults إنتاجية */
const TEST_POLICY = {
  ...DEV_RETENTION_POLICY,
  artifacts: 7,
  sessions: 30,
  loginTransactions: 14,
  runArchives: 90,
  memoryVector: 60,
  flywheelLessons: 60,
} as const;

describe("FC — مخطط سياسة الاحتفاظ الصارم", () => {
  it("يرفض القيم السالبة والصفر وغير الصحيحة", () => {
    expect(RetentionPolicySchema.safeParse({ ...TEST_POLICY, artifacts: 0 }).success).toBe(false);
    expect(RetentionPolicySchema.safeParse({ ...TEST_POLICY, artifacts: -5 }).success).toBe(false);
    expect(RetentionPolicySchema.safeParse({ ...TEST_POLICY, sessions: 1.5 }).success).toBe(false);
  });

  it("يرفض الإبطالات غير الدائمة والتدقيق غير الدائم — نزاعة محمية بالمخطط", () => {
    expect(RetentionPolicySchema.safeParse({ ...TEST_POLICY, revocations: 30 }).success).toBe(false);
    expect(RetentionPolicySchema.safeParse({ ...TEST_POLICY, auditLog: 365 }).success).toBe(false);
  });

  it("يرفض الحقل الزائد والناقص (strict) وربط كل البيانات بمدة واحدة ممنوع بنيوياً", () => {
    expect(RetentionPolicySchema.safeParse({ ...TEST_POLICY, extra: 1 }).success).toBe(false);
    const partial = { ...TEST_POLICY };
    delete (partial as { flywheelLessons?: unknown }).flywheelLessons;
    expect(RetentionPolicySchema.safeParse(partial).success).toBe(false);
    // كل صنف حقل مستقل — لا حقل «كل شيء»
    expect(Object.keys(RetentionPolicySchema.shape).length).toBeGreaterThanOrEqual(16);
  });

  it("سياسة التطوير نفسها مطابقة للمخطط", () => {
    expect(RetentionPolicySchema.safeParse(DEV_RETENTION_POLICY).success).toBe(true);
  });
});

describe("FC — منفّذ الاحتفاظ (المسح الدوري)", () => {
  function buildPortAndStores() {
    const semantic = createInMemorySemanticStore();
    const auth = createInMemoryAuthStore();
    const archives = createInMemoryRunArchiveStore();
    const lifecycle: TenantLifecycleStore = {
      ...semantic,
      ...auth,
      // لا بيانات متجهة/دروس في هذه البيئة — العدد صفر بصدق لا استثناء
      purgeExpiredVectorEmbeddings: () => Promise.resolve(0),
      purgeExpiredFlywheelLessons: () => Promise.resolve(0),
    };
    const port: RetentionSweepPort = {
      purgeExpiredArtifacts: (t, c) => lifecycle.purgeExpiredArtifacts(t, c),
      purgeExpiredSessions: (t, c) => lifecycle.purgeExpiredSessions(t, c),
      purgeExpiredLoginTransactions: (t, c) => lifecycle.purgeExpiredLoginTransactions(t, c),
      purgeExpiredRunArchives: (t, c) => archives.purgeExpiredBefore(t, c),
      purgeExpiredVectorEmbeddings: (t, c) => lifecycle.purgeExpiredVectorEmbeddings(t, c),
      purgeExpiredFlywheelLessons: (t, c) => lifecycle.purgeExpiredFlywheelLessons(t, c),
    };
    return { semantic, auth, archives, port };
  }

  it("يمسح المنتهي فقط: القديم يُحذف والحديث يبقى والمستأجر الآخر لا يُمس", async () => {
    const world = buildPortAndStores();
    await world.semantic.saveArtifact({ runId: "old", tenantId: "alpha", artifactJson: "{}", createdAt: "2026-08-01T00:00:00.000Z" });
    await world.semantic.saveArtifact({ runId: "new", tenantId: "alpha", artifactJson: "{}", createdAt: "2026-09-19T00:00:00.000Z" });
    await world.semantic.saveArtifact({ runId: "beta-old", tenantId: "beta", artifactJson: "{}", createdAt: "2026-08-01T00:00:00.000Z" });
    const result = await runRetentionSweep(world.port, TEST_POLICY, ["alpha"], NOW);
    expect(await world.semantic.getArtifact("alpha", "old")).toBeNull();
    expect(await world.semantic.getArtifact("alpha", "new")).not.toBeNull();
    // العزل: مستأجر آخر لم يُذكر في القائمة فلم يُمس
    expect(await world.semantic.getArtifact("beta", "beta-old")).not.toBeNull();
    const artifactsClass = result.classes.find((c) => c.dataClass === "artifacts");
    expect(artifactsClass).toMatchObject({ mode: "swept", removed: 1 });
  });

  it("idempotent: تشغيل ثانٍ يحذف صفراً بلا خطأ", async () => {
    const world = buildPortAndStores();
    await world.semantic.saveArtifact({ runId: "old", tenantId: "alpha", artifactJson: "{}", createdAt: "2026-08-01T00:00:00.000Z" });
    await runRetentionSweep(world.port, TEST_POLICY, ["alpha"], NOW);
    const second = await runRetentionSweep(world.port, TEST_POLICY, ["alpha"], NOW);
    expect(second.classes.find((c) => c.dataClass === "artifacts")?.removed).toBe(0);
  });

  it("يحذف الجلسات ومعاملات الدخول المنتهية والأرشيف القديم", async () => {
    const world = buildPortAndStores();
    await world.auth.putSession({
      sessionId: "s-old", tokenHash: "tok-old", csrfHash: "c", browserBindingHash: "b",
      identityId: "i1", authMethod: "oidc", membershipId: "m1", tenantId: "alpha",
      permissions: ["resource:read"], authorizationVersion: 1,
      idleExpiresAt: "2026-07-01T00:00:00.000Z", absoluteExpiresAt: "2026-07-01T00:00:00.000Z",
    });
    await world.auth.putLoginTransaction({
      transactionId: "t-old", stateHash: "st-old", browserBindingHash: "b", tenantId: "alpha",
      configVersion: 1, configInstanceId: "ci", nonce: "n", verifierEnvelope: "v",
      redirectUri: "https://x.test/cb", returnPath: "/", expiresAt: "2026-07-01T00:00:00.000Z",
    });
    await world.archives.archive({ tenantId: "alpha", runId: "r-old", snapshotJson: "{}", generation: 1, fence: 1, archivedAt: "2026-05-01T00:00:00.000Z" });
    const result = await runRetentionSweep(world.port, TEST_POLICY, ["alpha"], NOW);
    expect(await world.auth.findSessionByHash("tok-old")).toBeNull();
    expect(result.classes.find((c) => c.dataClass === "sessions")?.removed).toBe(1);
    expect(result.classes.find((c) => c.dataClass === "loginTransactions")?.removed).toBe(1);
    expect(result.classes.find((c) => c.dataClass === "runArchives")?.removed).toBe(1);
    expect((await world.archives.latest("alpha", "r-old"))).toBeNull();
  });

  it("الأصناف الدائمة والمعلنة توثق بأوضاعها — لا ادعاء حذف لم يقع", async () => {
    const world = buildPortAndStores();
    const result = await runRetentionSweep(world.port, TEST_POLICY, ["alpha"], NOW);
    const byClass = Object.fromEntries(result.classes.map((c) => [c.dataClass, c.mode]));
    expect(byClass["auditLog"]).toBe("permanent");
    expect(byClass["revocations"]).toBe("permanent");
    expect(byClass["certificates"]).toBe("permanent"); // سياسة الاختبار دائمة
    expect(byClass["semanticCore"]).toBe("tenant-lifetime");
    expect(byClass["episodicEvents"]).toBe("ttl-at-write");
    expect(byClass["operationalLogs"]).toBe("declared");
    expect(byClass["backups"]).toBe("declared");
    expect(byClass["memoryWorking"]).toBe("ephemeral");
    // كل الأصناف الستة عشر حاضرة في النتيجة
    expect(result.classes.length).toBe(16);
  });

  it("قائمة مستأجرين فارغة مرفوضة — لا مسح شامل بلا سياق", async () => {
    const world = buildPortAndStores();
    await expect(runRetentionSweep(world.port, TEST_POLICY, [], NOW)).rejects.toThrow("لا مسح شامل");
  });

  it("الإبطالات العامة تنجو من أي مسح — تحقق الشهادات المنشورة باقٍ", async () => {
    const world = buildPortAndStores();
    await world.semantic.revokeCertificate({ tenantId: "alpha", runId: "r1", verificationId: "ver-1", reason: "اختبار", revokedAt: "2026-01-01T00:00:00.000Z" });
    await runRetentionSweep(world.port, TEST_POLICY, ["alpha"], NOW);
    expect((await world.semantic.getRevocationByVerificationId("ver-1"))?.verificationId).toBe("ver-1");
  });
});
