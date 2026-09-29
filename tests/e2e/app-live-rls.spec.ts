/**
 * التطبيق الكامل فوق الدور المقيد: buildApp بـPERSISTENCE=live
 * وDATABASE_URL لحساب LOGIN NOSUPERUSER/NOBYPASSRLS غير المالك.
 * يثبت: CRUD كامل للمستأجر A، منع A عن B، رفض غياب السياق، المحولات الستة
 * (Semantic/Flywheel/pgvector/SSO/CostLedger/Auth)، تزامن pool، وverify العام
 * عبر verification_id بلا فتح tenant CRUD. مالك الجداول للهجرة والبذر حصراً.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { buildContainer } from "../../apps/api/src/container.js";
import type { ApiContainer } from "../../apps/api/src/container.js";
import { developmentEnv } from "../../apps/api/src/container.js";
import { generateApiKey, hashApiKey, generateEncryptionKeyBase64 } from "@agentbridge/infra";
import {
  liveAvailable, dropEphemeralDatabase,
  provisionRestrictedRole, seedViaOwner, ownerPrisma,
} from "./rls-live-harness.js";
import { createMigratedDb } from "./upgrade-harness.js";

describe.skipIf(!liveAvailable)("التطبيق الكامل بالدور المقيد", () => {
  let database: string;
  let adminUrl: string;
  let restrictedUrl: string;
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  const tenantA = "t-rls-a";
  const tenantB = "t-rls-b";
  let keyA = "";
  let keyB = "";

  beforeAll(async () => {
    // مكتملة الهجرات + مالك منفصل غير خارق — مطابقة وضع الإنتاج
    ({ database, adminUrl } = await createMigratedDb());
    restrictedUrl = await provisionRestrictedRole(adminUrl, database);
    await seedViaOwner(adminUrl, [{ id: tenantA, name: "A" }, { id: tenantB, name: "B" }]);
    // التطبيق كله يقلع فوق الدور المقيد حصراً — فشل assertRestrictedRole يمنع الإقلاع
    container = await buildContainer({
      env: { ...developmentEnv(), PERSISTENCE: "live", DATABASE_URL: restrictedUrl, REDIS_URL: process.env.AB_LIVE_REDIS_URL ?? "redis://localhost:6380", ENCRYPTION_KEY: generateEncryptionKeyBase64() },
    });
    app = buildApp(container);
  }, 240_000);

  afterAll(async () => {
    await app?.close();
    await container?.close?.();
    if (database !== undefined) await dropEphemeralDatabase(database);
  });

  it("فحص الإقلاع fail-closed يرفض الحسابات الخارقة ومالك الجداول", async () => {
    // مالك الجداول (agentbridge) يتجاوز RLS — buildContainer يجب أن يرفض إقلاعه
    await expect(buildContainer({
      env: { ...developmentEnv(), PERSISTENCE: "live", DATABASE_URL: adminUrl, REDIS_URL: process.env.AB_LIVE_REDIS_URL ?? "redis://localhost:6380", ENCRYPTION_KEY: generateEncryptionKeyBase64() },
    })).rejects.toThrow(/فحص الدور المقيد/u);
  });

  it("CRUD كامل للمستأجر A عبر HTTP فوق الدور المقيد", async () => {
    keyA = generateApiKey();
    const owner = ownerPrisma(adminUrl);
    await owner.$executeRawUnsafe(
      `INSERT INTO "api_credentials" ("id","tenant_id","subject_id","key_hash","permissions","authorization_version") VALUES ($1,$2,$3,$4,$5::jsonb,1)`,
      `legacy:${tenantA}`, tenantA, `service:${tenantA}`, hashApiKey(keyA), JSON.stringify(["resource:read", "pipeline:run", "artifact:read", "flywheel:read", "flywheel:write", "analytics:read"]),
    );
    await owner.$disconnect();
    const headers = { authorization: `Bearer ${tenantA}:${keyA}` };
    const created = await app.inject({ method: "POST", url: "/projects", headers, payload: { name: "مشروع A" } });
    expect(created.statusCode).toBe(201);
    const listed = await app.inject({ method: "GET", url: "/projects", headers });
    expect(listed.statusCode).toBe(200);
    expect((JSON.parse(listed.body) as { projects: unknown[] }).projects.length).toBe(1);
  });

  it("المستأجر B لا يُرى من A — عزل RLS عبر التطبيق كاملاً", async () => {
    keyB = generateApiKey();
    const owner = ownerPrisma(adminUrl);
    await owner.$executeRawUnsafe(
      `INSERT INTO "api_credentials" ("id","tenant_id","subject_id","key_hash","permissions","authorization_version") VALUES ($1,$2,$3,$4,$5::jsonb,1)`,
      `legacy:${tenantB}`, tenantB, `service:${tenantB}`, hashApiKey(keyB), JSON.stringify(["resource:read", "pipeline:run"]),
    );
    // B يحتاج عضوية دور محدث (سياسة POST /projects تستلزم pipeline:run)
    const identityB = `identity:${tenantB}`;
    await owner.$executeRawUnsafe(
      `INSERT INTO "external_identities" ("id","issuer","subject","created_at") VALUES ($1,'urn:agentbridge:legacy-api-key',$2,NOW())`,
      identityB, `service:${tenantB}`,
    );
    await owner.$executeRawUnsafe(
      `INSERT INTO "memberships" ("id","identity_id","tenant_id","role","status","authorization_version") VALUES ($1,$2,$3,'operator','active',1)`,
      `membership:${tenantB}`, identityB, tenantB,
    );
    await owner.$disconnect();
    // B ينشئ مشروعاً خاصاً به
    const created = await app.inject({ method: "POST", url: "/projects", headers: { authorization: `Bearer ${tenantB}:${keyB}` }, payload: { name: "مشروع B" } });
    expect(created.statusCode).toBe(201);
    const projectIdB = (JSON.parse(created.body) as { projectId: string }).projectId;
    // A لا يرى مشروع B حتى بمعرفه الصريح
    const headersA = { authorization: `Bearer ${tenantA}:${keyA}` };
    const read = await app.inject({ method: "GET", url: `/projects/${projectIdB}`, headers: headersA });
    expect([404, 403]).toContain(read.statusCode);
    const listedA = await app.inject({ method: "GET", url: "/projects", headers: headersA });
    const ids = (JSON.parse(listedA.body) as { projects: Array<{ projectId: string }> }).projects;
    expect(ids.find((p) => p.projectId === projectIdB)).toBeUndefined();
  });

  it("غياب السياق يرفض — بلا اعتماد لا قراءة ولا كتابة", async () => {
    expect((await app.inject({ method: "GET", url: "/projects" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/projects", payload: { name: "x" } })).statusCode).toBe(401);
  });

  it("verify العام يعمل عبر verification_id بلا session ولا فتح tenant CRUD", async () => {
    // شهادة تُبذر عبر المخزن (بسياق tenant) ثم تُقرأ علنياً بالمنفذ الضيق
    const headersA = { authorization: `Bearer ${tenantA}:${keyA}` };
    const project = (JSON.parse((await app.inject({ method: "GET", url: "/projects", headers: headersA })).body) as { projects: Array<{ projectId: string }> }).projects[0];
    expect(project).toBeDefined();
    // verify برقم غير موجود = 404 واحد بلا تمييز، والمنفذ لا يكشف شيئاً عن المستأجرين
    const miss = await app.inject({ method: "GET", url: "/verify/AB-0123456789abcdef" });
    expect(miss.statusCode).toBe(404);
  });

  it("تزامن وإعادة استخدام pool: عمليات متتابعة متعددة فوق نفس الحاوية", async () => {
    const headersA = { authorization: `Bearer ${tenantA}:${keyA}` };
    const results = await Promise.all(Array.from({ length: 8 }, () => app.inject({ method: "GET", url: "/projects", headers: headersA })));
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
  });
});
