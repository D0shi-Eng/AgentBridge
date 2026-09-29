/**
 * اختبار دورة حياة المستأجر الحي — هجرة fresh
 * + onboarding ذري بتدقيق داخل المعاملة + قفل bootstrap
 * + حذف مسوَّر فوق سجل العمليات + تقليل البيانات
 * + حدود الاحتفاظ فوق PostgreSQL حقيقية بدور
 * NOSUPERUSER/NOBYPASSRLS.
 *
 * شرط العمل: قاعدة حية على AB_LIVE_DATABASE_URL أو عنوان docker-compose.dev.
 * غيابها تخطٍّ موثق باسمه — لا ادعاء إغلاق بلا قاعدة. القاعدة مؤقتة
 * تُنشأ وتُمسح في الجلسة نفسها — لا بيانات مستخدم ولا بيانات حقيقية.
 * التوازي الحقيقي بين عمليتين منفصلتين يغطيه live-concurrency.spec.ts
 * في tests/e2e؛ هنا توازي اتصالين فعليين فوق القاعدة نفسها.
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { LIVE_DATABASE_URL } from "./live-config.js";
import { withTenantPrisma } from "./prisma-scope.js";
import {
  HashChainAuditLog, confirmTenantDeletionFenced, createPrismaDeletionOperationStore,
  createPrismaRunArchiveStore, createPrismaSemanticStore, createPrismaTenantLifecycle,
  dryRunTenantDeletion, fenceHashOf, onboardTenantLive, runRetentionSweep,
  type RetentionSweepPort,
} from "./index.js";

const ADMIN_URL = process.env.AB_LIVE_DATABASE_URL ?? LIVE_DATABASE_URL;

async function probe(url: string): Promise<boolean> {
  const probe = new PrismaClient({ datasources: { db: { url: `${url}${url.includes("?") ? "&" : "?"}connect_timeout=2` } } });
  try { await probe.$queryRaw`SELECT 1`; return true; } catch { return false; } finally { await probe.$disconnect(); }
}

const available = await probe(ADMIN_URL);
if (!available) {
  console.info("[تخطٍّ موثق] اختبار دورة حياة المستأجر الحي: لا قاعدة PostgreSQL على العنوان المضبوط");
}

function deployMigrations(database: string): void {
  const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
  const infraRoot = resolve(schemaPath, "../..");
  const url = `${ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/u, "")}/${database}`;
  execSync(`npx prisma migrate deploy --schema ${JSON.stringify(schemaPath)}`, {
    stdio: "inherit", env: { ...process.env, DATABASE_URL: url }, cwd: infraRoot,
  });
}

async function restrictedClient(url: string): Promise<PrismaClient> {
  const separator = url.includes("?") ? "&" : "?";
  const client = new PrismaClient({ datasources: { db: { url: `${url}${separator}connection_limit=1` } } });
  await client.$executeRawUnsafe("SET ROLE agentbridge_app");
  return client;
}

const NOW = "2026-09-20T12:00:00.000Z";
const FENCE = `lifecycle-live-${randomUUID().replaceAll("-", "").slice(0, 20)}`;
const FENCE2 = `lifecycle-live-${randomUUID().replaceAll("-", "").slice(0, 20)}`;

describe.skipIf(!available)("دورة حياة المستأجر الحية", () => {
  const database = `ab_fsc_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let admin: PrismaClient;
  let ownerFresh: PrismaClient;
  let adminUrl: string;
  let restricted: PrismaClient;
  let restricted2: PrismaClient;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE ${JSON.stringify(database)}`);
    adminUrl = `${ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/u, "")}/${database}`;
    deployMigrations(database);
    // عميل المالك على قاعدة الفحص نفسها — للعد الإداري والبذر حصراً
    ownerFresh = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    restricted = await restrictedClient(adminUrl);
    restricted2 = await restrictedClient(adminUrl);
  });

  afterAll(async () => {
    await restricted?.$disconnect();
    await restricted2?.$disconnect();
    await ownerFresh?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${JSON.stringify(database)} WITH (FORCE)`);
    await admin?.$disconnect();
  });

  it("الهجرة الجديدة تنفذ fresh: سجل عمليات الحذج بفهرسه الجزئي الفريد وRLS مفروض", async () => {
    const owner = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    try {
      const indexes = await owner.$queryRawUnsafe<Array<{ indexname: string }>>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'tenant_deletion_operations'`,
      ) as Array<{ indexname: string }>;
      expect(indexes.map((i) => i.indexname)).toContain("tenant_deletion_operations_active_per_tenant");
      const rls = await owner.$queryRawUnsafe<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'tenant_deletion_operations'`,
      ) as Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>;
      expect(rls[0]?.relrowsecurity).toBe(true);
      expect(rls[0]?.relforcerowsecurity).toBe(true);
    } finally {
      await owner.$disconnect();
    }
  });

  it("onboarding الحي ذري شاملاً التدقيق — الوصل داخل نفس المعاملة والتكرار يرفض", async () => {
    const input = {
      tenantId: "live-alpha", tenantName: "ألفا الحية", ownerIssuer: "https://idp.live.test", ownerSubject: "owner-1",
      credentialPermissions: ["resource:read", "pipeline:run"] as const, expiresInDays: 30, nowIso: NOW,
    };
    const result = await onboardTenantLive(admin, restricted, input);
    expect(result.credentialId).toBe("bootstrap-live-alpha");
    // وصل تدقيق الـonboarding ملتزم — ولو فشل لتراجعت الكتابة كلها
    const semantic = createPrismaSemanticStore(restricted);
    const entries = await semantic.listAuditEntries("live-alpha");
    expect(entries.some((e) => e.stage === "tenant_onboarding" && e.decision === "granted")).toBe(true);
    const lifecycle = createPrismaTenantLifecycle(restricted);
    expect((await lifecycle.getTenantLifecycleState("live-alpha"))).not.toBeNull();
    const credential = await withTenantPrisma(restricted, "live-alpha", (tx) => tx.apiCredential.findUnique({ where: { id: result.credentialId } }));
    expect(credential?.expires_at?.toISOString()).toBe(result.expiresAt);
    expect(credential?.revoked_at).toBeNull();
    // تكرار نفس المستأجر = رفض كامل
    await expect(onboardTenantLive(admin, restricted, input)).rejects.toMatchObject({ code: "TENANT_EXISTS" });
    // نفس المالك على مستأجر جديد = رفض بلا كتابة جزئية
    await expect(onboardTenantLive(admin, restricted, { ...input, tenantId: "live-alpha2" })).rejects.toMatchObject({ code: "OWNER_EXISTS" });
    expect(await lifecycle.getTenantLifecycleState("live-alpha2")).toBeNull();
  });

  it("bootstrap أول متوازٍ فوق اتصالين فعليين — واحد فقط ينجح والثاني يرفض", async () => {
    // مستأجر مسؤول أول بأولوية القفل — ثم متوازيان يتصارنان على القفل
    await onboardTenantLive(ownerFresh, restricted, {
      tenantId: "live-root", tenantName: "الجذر", ownerIssuer: "https://idp.live.test", ownerSubject: "root-1",
      credentialPermissions: ["resource:read"] as const, expiresInDays: 30, nowIso: NOW, initial: true,
    });
    const attempt = (client: PrismaClient, tenantId: string, subject: string) => onboardTenantLive(ownerFresh, client, {
      tenantId, tenantName: `مسؤول-${tenantId}`, ownerIssuer: "https://idp.live.test", ownerSubject: subject,
      credentialPermissions: ["resource:read"] as const, expiresInDays: 30, nowIso: NOW, initial: true,
    });
    const results = await Promise.allSettled([
      attempt(restricted, "live-race-a", "race-a"),
      attempt(restricted2, "live-race-b", "race-b"),
    ]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(succeeded).toHaveLength(0); // bootstrap تم سابقاً — كلاهما يرفض
    for (const rejection of rejected) {
      expect((rejection as PromiseRejectedResult).reason).toMatchObject({ code: "BOOTSTRAP_DONE" });
    }
    const adminCount = await ownerFresh.$queryRawUnsafe<Array<{ count: string }>>("SELECT count(*)::text AS count FROM tenants WHERE is_admin = true");
    expect(Number(adminCount[0]?.count ?? "0")).toBe(1); // مستأجر إداري واحد لا اثنان
  });

  it("حذف حي مسوَّر — إبطال باقٍ، تدقيق موصل مرة واحدة، قبر مُقلَّل، هوية يتيمة محذوفة، إعادة إرسال تعيد الإيصال", async () => {
    const semantic = createPrismaSemanticStore(restricted);
    const audit = new HashChainAuditLog(semantic);
    const lifecycle = createPrismaTenantLifecycle(restricted);
    const operations = createPrismaDeletionOperationStore(restricted);
    // بيانات تشغيلية + إبطال عام + هوية يتيمة + هوية مشتركة مع live-beta
    await withTenantPrisma(restricted, "live-alpha", async (tx) => {
      await tx.project.create({ data: { id: "p1", tenant_id: "live-alpha", name: "مشروع", created_at: new Date(NOW) } });
      await tx.spec.create({ data: { id: "s1", tenant_id: "live-alpha", project_id: "p1", content: "openapi: 3.0.0", created_at: new Date(NOW) } });
      await tx.pipeline.create({ data: { id: "r1", tenant_id: "live-alpha", project_id: "p1", spec_id: "s1", status: "completed", repair_cycles_used: 0, created_at: new Date(NOW), updated_at: new Date(NOW) } });
      await tx.certificate.create({ data: { run_id: "r1", tenant_id: "live-alpha", final_score: 90, granted: true, verification_id: "ver-live-1", certificate_json: "{}", issued_at: new Date(NOW) } });
      await tx.certificateRevocation.create({ data: { tenant_id: "live-alpha", run_id: "r1", verification_id: "ver-live-1", reason: "اختبار حي", revoked_at: new Date(NOW) } });
    });
    await onboardTenantLive(admin, restricted, {
      tenantId: "live-beta", tenantName: "بيتا الحية", ownerIssuer: "https://idp.live.test", ownerSubject: "owner-2",
      credentialPermissions: ["resource:read"] as const, expiresInDays: 30, nowIso: NOW,
    });
    // هوية مشتركة (عضو في alpha وbeta) — يجب أن تبقى بعد حذف alpha؛
    // البذر عبر المالك على قاعدة الفحص (النمط المرجعي في prisma-auth-live)
    await ownerFresh.$executeRawUnsafe(`INSERT INTO "external_identities" ("id","issuer","subject","created_at") VALUES ('ident-shared-live','https://idp.live.test','shared-live', '${NOW}')`);
    await ownerFresh.$executeRawUnsafe(`INSERT INTO "memberships" ("id","identity_id","tenant_id","role","status","authorization_version") VALUES ('member-shared-a','ident-shared-live','live-alpha','reader','active',1), ('member-shared-b','ident-shared-live','live-beta','reader','active',1)`);
    const dry = await dryRunTenantDeletion({ lifecycle, audit }, "live-alpha");
    expect(dry.verdict).toBe("READY");
    expect(dry.impact?.revocationsKept).toBe(1);
    // الحجز القانوني يمنع قبل أي كتابة
    await lifecycle.setTenantLegalHold("live-alpha", "2099-01-01T00:00:00.000Z");
    await expect(confirmTenantDeletionFenced({ lifecycle, operations }, "live-alpha", FENCE, "live-alpha", NOW))
      .rejects.toMatchObject({ code: "LEGAL_HOLD" });
    await lifecycle.setTenantLegalHold("live-alpha", null);
    // التنفيذ الكامل المسوَّر
    const { receipt, replayed } = await confirmTenantDeletionFenced({ lifecycle, operations }, "live-alpha", FENCE, "live-alpha", NOW);
    expect(replayed).toBe(false);
    expect(receipt.impact.pipelines).toBe(1);
    expect(receipt.fenceHash).toBe(fenceHashOf(FENCE));
    // الإبطال العام باقٍ — /verify لن ينكسر
    const revocation = await withTenantPrisma(restricted, "live-alpha", (tx) => tx.certificateRevocation.findUnique({ where: { verification_id: "ver-live-1" } }));
    expect(revocation?.verification_id).toBe("ver-live-1");
    // القبر المُقلَّل: بلا اسم حقيقي وبلا hash يعمل
    const tenantRow = await withTenantPrisma(restricted, "live-alpha", (tx) => tx.tenant.findUnique({ where: { id: "live-alpha" } }));
    expect(tenantRow?.deleted_at?.toISOString()).toBe(NOW);
    expect(tenantRow?.name).toBe("deleted-tenant");
    expect(tenantRow?.api_key_hash).toBe("deleted:tombstone:no-credential");
    // هوية مالك alpha اليتيمة حذفت والمشتركة بقيت؛ التحقق عبر
    // المالك — قراءة الهويات الخارجية العادية مقصورة بنيوياً على الدور الحي
    const orphanGone = await ownerFresh.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM external_identities WHERE subject = 'owner-1'`);
    expect(orphanGone[0]?.n).toBe(0);
    const sharedKept = await ownerFresh.$queryRawUnsafe<Array<{ n: number }>>(
      `SELECT count(*)::int AS n FROM external_identities WHERE subject = 'shared-live'`);
    expect(sharedKept[0]?.n).toBe(1);
    // وصل الحذف مكتوب مرة واحدة بالبصمة لا الخام
    const entries = await semantic.listAuditEntries("live-alpha");
    const deletionEntries = entries.filter((e) => e.stage === "tenant_deletion" && e.decision === "completed");
    expect(deletionEntries).toHaveLength(1);
    expect(JSON.stringify(entries)).not.toContain(FENCE);
    // إعادة الإرسال بنفس النسيج = نفس الإيصال بلا وصل ثانٍ
    const replay = await confirmTenantDeletionFenced({ lifecycle, operations }, "live-alpha", FENCE, "live-alpha", NOW);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt).toEqual(receipt);
    const entriesAfterReplay = await semantic.listAuditEntries("live-alpha");
    expect(entriesAfterReplay.filter((e) => e.stage === "tenant_deletion" && e.decision === "completed")).toHaveLength(1);
    // نسيج مختلف = تعارض صريح
    await expect(confirmTenantDeletionFenced({ lifecycle, operations }, "live-alpha", FENCE2, "live-alpha", NOW))
      .rejects.toMatchObject({ code: "FENCE_MISMATCH" });
  });

  it("مسح معاملات الدخول الحي — المستهلك الحديث يبقى والقديم يُحذف والعزل نافذ", async () => {
    const lifecycle = createPrismaTenantLifecycle(restricted);
    const base = {
      browser_binding_hash: "bind", config_version: 1, config_instance_id: "inst",
      nonce: "n", verifier_envelope: "{}", redirect_uri: "http://127.0.0.1/cb", return_path: "/",
    };
    const txSeed = (id: string, tenant: string, expires: string, consumed: string | null): string =>
      `INSERT INTO "login_transactions" ("id","state_hash","browser_binding_hash","tenant_id","config_version","config_instance_id","nonce","verifier_envelope","redirect_uri","return_path","expires_at","consumed_at") VALUES ('${id}','sh-${id}','b','${tenant}',1,'inst-000000000000000000000000000001','n','{}','http://127.0.0.1/cb','/','${expires}',${consumed === null ? "NULL" : `'${consumed}'`})`;
    await ownerFresh.$executeRawUnsafe(txSeed("lt-consumed-old", "live-beta", "2026-09-20T13:00:00.000Z", "2026-06-01T00:00:00.000Z"));
    await ownerFresh.$executeRawUnsafe(txSeed("lt-consumed-new", "live-beta", "2026-09-20T13:00:00.000Z", NOW));
    await ownerFresh.$executeRawUnsafe(txSeed("lt-expired-old", "live-beta", "2026-06-01T00:00:00.000Z", null));
    await ownerFresh.$executeRawUnsafe(txSeed("lt-fresh", "live-beta", "2026-09-20T13:00:00.000Z", null));
    // صف للمستأجر الآخر (alpha المُدقَّر) يجب ألا يمس بعزل النطاق
    await ownerFresh.$executeRawUnsafe(txSeed("lt-alpha", "live-alpha", "2026-01-01T00:00:00.000Z", null));
    void base;
    const removed = await lifecycle.purgeExpiredLoginTransactions("live-beta", NOW);
    expect(removed).toBe(2); // consumed-old وexpired-old حصراً
    const remaining = await withTenantPrisma(restricted, "live-beta", (tx) =>
      tx.loginTransaction.findMany({ where: { tenant_id: "live-beta" }, select: { id: true } }));
    expect(remaining.map((r) => r.id).sort()).toEqual(["lt-consumed-new", "lt-fresh"]);
    const alphaRow = await withTenantPrisma(restricted, "live-alpha", (tx) =>
      tx.loginTransaction.findFirst({ where: { tenant_id: "live-alpha" } }));
    expect(alphaRow?.id).toBe("lt-alpha"); // العزل بين المستأجرين نافذ
  });

  it("مسح الاحتفاظ الحي: المنتهي يُحذف والحديث والمستأجر الآخر يبقيان", async () => {
    const lifecycle = createPrismaTenantLifecycle(restricted);
    await withTenantPrisma(restricted, "live-beta", async (tx) => {
      await tx.project.create({ data: { id: "bp1", tenant_id: "live-beta", name: "مشروع بيتا", created_at: new Date(NOW) } });
      await tx.spec.create({ data: { id: "bs1", tenant_id: "live-beta", project_id: "bp1", content: "openapi: 3.0.0", created_at: new Date(NOW) } });
      await tx.spec.create({ data: { id: "bs2", tenant_id: "live-beta", project_id: "bp1", content: "openapi: 3.0.1", created_at: new Date(NOW) } });
      await tx.pipeline.create({ data: { id: "br-old", tenant_id: "live-beta", project_id: "bp1", spec_id: "bs1", status: "completed", repair_cycles_used: 0, created_at: new Date(NOW), updated_at: new Date(NOW) } });
      await tx.pipeline.create({ data: { id: "br-new", tenant_id: "live-beta", project_id: "bp1", spec_id: "bs2", status: "completed", repair_cycles_used: 0, created_at: new Date(NOW), updated_at: new Date(NOW) } });
      await tx.artifact.create({ data: { run_id: "br-old", tenant_id: "live-beta", artifact_json: "{}", created_at: new Date("2026-06-01T00:00:00.000Z") } });
      await tx.artifact.create({ data: { run_id: "br-new", tenant_id: "live-beta", artifact_json: "{}", created_at: new Date(NOW) } });
    });
    const sweepPort: RetentionSweepPort = {
      ...lifecycle,
      purgeExpiredRunArchives: (t, c) => createPrismaRunArchiveStore(restricted).purgeExpiredBefore(t, c),
    };
    const result = await runRetentionSweep(sweepPort, {
      episodicEventsDays: 7, signedSnapshotsDays: 7, runArchives: "permanent", certificates: "permanent",
      artifacts: 30, auditLog: "permanent", revocations: "permanent", semanticCore: "tenant-lifetime",
      sessions: "permanent", loginTransactions: "permanent", operationalLogs: "permanent", backups: "permanent",
      memoryWorking: "ephemeral", memoryVector: "permanent", flywheelLessons: "permanent", ssoConfig: "tenant-lifetime",
    }, ["live-beta"], NOW);
    expect(result.classes.find((c) => c.dataClass === "artifacts")).toMatchObject({ mode: "swept", removed: 1 });
    const remaining = await withTenantPrisma(restricted, "live-beta", (tx) => tx.artifact.findMany({ where: { tenant_id: "live-beta" } }));
    expect(remaining.map((a) => a.run_id).sort()).toEqual(["br-new"]);
  });
});
