/**
 * public verify حياً إيجابي وسلبي:
 * 200 بقائمة بيضاء حصراً، 404 موحد، JSON تالف منضبط، لا تسريب ولا GUC
 * بعد الطلب، ولا CRUD، وعزل المستأجرين في القراءة بالمنفذ الضيق.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { withLookupPrisma, withTenantPrisma, generateEncryptionKeyBase64 } from "@agentbridge/infra";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv } from "./container.js";
import type { ApiContainer } from "./container.js";
import { dropEphemeralDatabase, provisionRestrictedRole, restrictedPrisma, seedViaOwner } from "../../../tests/e2e/rls-live-harness.js";
import { createMigratedDb, liveUp } from "../../../tests/e2e/upgrade-harness.js";

let container: ApiContainer;
let app: ReturnType<typeof buildApp>;
let prisma: PrismaClient | null = null;
let database = "";

beforeAll(async () => {
  if (!liveUp) return;
  // مكتملة الهجرات + مالك منفصل غير خارق — كي يقيس فحص الإقلاع وضع الإنتاج
  const created = await createMigratedDb();
  database = created.database;
  const adminUrl = created.adminUrl;
  prisma = restrictedPrisma(await provisionRestrictedRole(adminUrl, database));
  await seedViaOwner(adminUrl, [{ id: "t-ver-a", name: "A" }, { id: "t-ver-b", name: "B" }]);
  container = await buildContainer({
    env: { ...developmentEnv(), PERSISTENCE: "live", DATABASE_URL: await provisionRestrictedRole(adminUrl, database), REDIS_URL: process.env.AB_LIVE_REDIS_URL ?? "redis://localhost:6380", ENCRYPTION_KEY: generateEncryptionKeyBase64() },
  });
  app = buildApp(container);
}, 240_000);

afterAll(async () => {
  await app?.close();
  await container?.close?.();
  await prisma?.$disconnect();
  if (database !== "") await dropEphemeralDatabase(database);
});

describe.skipIf(!liveUp)("public verify حي", () => {
  /** سلسلة مرجعية كاملة للمستأجر: project ← spec ← pipeline ← شهادة */
  async function seedChain(tenantId: string, tag: string, verificationId: string, certificateJson: string): Promise<void> {
    await withTenantPrisma(prisma!, tenantId, async (tx) => {
      const now = new Date();
      await tx.project.create({ data: { id: `p-${tag}`, tenant_id: tenantId, name: `مشروع ${tag}`, created_at: now } });
      await tx.spec.create({ data: { id: `s-${tag}`, tenant_id: tenantId, project_id: `p-${tag}`, content: "{}", created_at: now } });
      await tx.pipeline.create({ data: { id: `r-${tag}`, tenant_id: tenantId, project_id: `p-${tag}`, spec_id: `s-${tag}`, status: "completed", repair_cycles_used: 0, created_at: now, updated_at: now } });
      await tx.certificate.create({ data: { run_id: `r-${tag}`, tenant_id: tenantId, final_score: 96, granted: true, verification_id: verificationId, certificate_json: certificateJson, issued_at: now } });
    });
  }

  it("1-4: شهادة صالحة عبر المسار المقيد ثم 200 عام بقائمة بيضاء حصراً", async () => {
    await seedChain("t-ver-a", "ver", "AB-0123456789abcdef", JSON.stringify({ artifactsHash: "hash-ver-1", tenantSecret: "يجب ألا يخرج" }));
    const response = await app.inject({ method: "GET", url: "/verify/AB-0123456789abcdef" });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    // الحقل signature {present} في القائمة البيضاء — حضور التوقيع وصلاحيته
    // العلم revoked الصريح لعقد الإبطال الموصول
    expect(Object.keys(body).sort()).toEqual(["artifactsHash", "finalScore", "granted", "issuedAt", "revoked", "signature", "verificationId"]);
    expect(body["revoked"]).toBe(false);
    expect(body["signature"]).toEqual({ present: false });
    expect(body["finalScore"]).toBe(96);
    expect(response.body).not.toContain("tenantSecret");
    expect(response.body).not.toContain("t-ver-a");
  });

  it("5-8: 404 موحد للغير موجود وللصيغة الخاطئة وللتالف، بلا تمييز ولا تسريب", async () => {
    const missing = await app.inject({ method: "GET", url: "/verify/AB-ffffffffffffffff" });
    const malformed = await app.inject({ method: "GET", url: "/verify/ab-short" });
    expect(missing.statusCode).toBe(404);
    expect(malformed.statusCode).toBe(404);
    expect(missing.body).toBe(malformed.body);
    // شهادة مخزنة بـJSON تالف: منضبط 404 لا 500 ولا تسريب
    await seedChain("t-ver-b", "bad", "AB-1111111111111111", "{corrupted-json");
    const corrupted = await app.inject({ method: "GET", url: "/verify/AB-1111111111111111" });
    expect(corrupted.statusCode).toBe(404);
    expect(corrupted.body).toBe(missing.body);
  });

  it("9-12: لا enumeration، وverify لا يمنح CRUD، وlookup المحلي بالمعاملة لا يتسرب", async () => {
    // رسائل 404 متطابقة حرفياً بين الحالات ⇒ لا تمييز يسمح بالتعداد
    const probe = await app.inject({ method: "GET", url: "/verify/AB-2222222222222222" });
    expect(probe.body).toBe((await app.inject({ method: "GET", url: "/verify/xx" })).body);
    // المسار العام لا يمنح أي عملية كتابة (GET وحده مسجل)
    const post = await app.inject({ method: "POST", url: "/verify/AB-0123456789abcdef" });
    expect([404, 405]).toContain(post.statusCode);
    // المنفذ الضيق verification_exact_lookup داخل معاملة — لا GUC بعدها
    await withLookupPrisma(prisma!, [["app.verification_id", "AB-0123456789abcdef"]], async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM "certificates"`);
      expect(rows[0]?.n).toBe(1);
    });
    const leaked = await prisma!.$queryRawUnsafe<Array<{ v: string }>>(
      `SELECT current_setting('app.verification_id', true) AS v`);
    expect(leaked[0]?.v).toBe("");
  });

  it("13-15: A لا يستخدم verify للوصول لبيانات B الخاصة (القراءة بالمفتاح العام فقط)", async () => {
    // شهادة B تستجيب للعامة بالحقول البيضاء فقط — بلا tenantId ولا runId ولا مشروعات
    const response = await app.inject({ method: "GET", url: "/verify/AB-1111111111111111" });
    expect(response.statusCode).toBe(404); // تالفة: مرفوضة للجميع بمن فيهم A
    // وقارئ A عبر المخزن لا يرى شهادة B بنطاقه (عزل القراءة الطبيعي)
    await withTenantPrisma(prisma!, "t-ver-a", async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM "certificates"`);
      expect(rows[0]?.n).toBe(1);
    });
  });
});
