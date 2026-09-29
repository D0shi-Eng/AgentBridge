/**
 * اختبار تكامل حي مشروط — هجرات fresh/upgrade وعزل RLS بدور
 * NOSUPERUSER/NOBYPASSRLS على قاعدة معزولة.
 *
 * شرط العمل: قاعدة PostgreSQL حية على AB_LIVE_DATABASE_URL أو عنوان
 * docker-compose.dev.yaml. غيابها يعني تخطياً موثقاً باسمه (لا كسر CI)
 * ويبقي الديون IMPLEMENTED_NOT_VERIFIED دون أي ادعاء إغلاق.
 *
 * قاعدة بيانات الاختبار مؤقتة تُنشأ وتُمسح في نفس الجلسة — لا بيانات مستخدم.
 */
import { execSync } from "node:child_process";
import { LIVE_DATABASE_URL } from "./live-config.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { createPrismaAuthStore } from "./prisma-auth-store.js";
import { withLookupPrisma, withTenantPrisma } from "./prisma-scope.js";

const ADMIN_URL = process.env.AB_LIVE_DATABASE_URL ?? LIVE_DATABASE_URL;

async function probe(url: string): Promise<boolean> {
  const probe = new PrismaClient({ datasources: { db: { url: `${url}${url.includes("?") ? "&" : "?"}connect_timeout=2` } } });
  try { await probe.$queryRaw`SELECT 1`; return true; } catch { return false; } finally { await probe.$disconnect(); }
}

const available = await probe(ADMIN_URL);
if (!available) {
  console.info("[تخطٍّ موثق] اختبار RLS الحي: لا قاعدة PostgreSQL على العنوان المضبوط — أقلع docker-compose.dev.yaml أو اضبط AB_LIVE_DATABASE_URL");
}

/** تشغيل هجرات Prisma (deploy) على قاعدة عبر npx — fresh حرفي */
function deployMigrations(database: string): void {
  const schemaPath = fileURLToPath(new URL("../prisma/schema.prisma", import.meta.url));
  // عميل prisma CLI يتوفر في حزمة infra نفسها — التشغيل من هناك يجنّب جلب الشبكة
  const infraRoot = resolve(schemaPath, "../..");
  const url = `${ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/u, "")}/${database}`;
  execSync(`npx prisma migrate deploy --schema ${JSON.stringify(schemaPath)}`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url },
    cwd: infraRoot,
  });
}

/** عميل بدور تشغيل مقيد — اتصال وحيد حتى يبقى SET ROLE حتمياً على نفس الوصلة */
async function restrictedClient(url: string): Promise<PrismaClient> {
  const separator = url.includes("?") ? "&" : "?";
  const client = new PrismaClient({ datasources: { db: { url: `${url}${separator}connection_limit=1` } } });
  // الدور المقيد على الوصلة الوحيدة — كل استعلام لاحق يرثه
  await client.$executeRawUnsafe("SET ROLE agentbridge_app");
  return client;
}

describe.skipIf(!available)("RLS الحي بدور مقيد", () => {
  const database = `ab_rls_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let admin: PrismaClient;
  let adminUrl: string;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE ${JSON.stringify(database)}`);
    adminUrl = `${ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/u, "")}/${database}`;
    await deployMigrations(database);
  });

  afterAll(async () => {
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${JSON.stringify(database)} WITH (FORCE)`);
    await admin?.$disconnect();
  });

  it("الدور agentbridge_app NOSUPERUSER وNOBYPASSRLS فعلاً", async () => {
    const rows = await admin.$queryRawUnsafe<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = 'agentbridge_app'`) as Array<{ rolsuper: boolean; rolbypassrls: boolean }>;
    expect(rows.length).toBe(1);
    expect(rows[0]?.rolsuper).toBe(false);
    expect(rows[0]?.rolbypassrls).toBe(false);
  });

  it("بدون سياق RLS لا يرى الدور المقيد أي صف — SET LOCAL لا يتسرب للجلسة", async () => {
    const owner = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    await owner.$executeRawUnsafe(`INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ('t-seed','بذرة','h',false,NOW())`);
    await owner.$disconnect();

    const restricted = await restrictedClient(adminUrl);
    // قراءة بلا سياق = صفر صفوف رغم وجود الصف
    const blind = await restricted.$queryRawUnsafe<Array<unknown>>(`SELECT * FROM "tenants"`) as unknown[];
    expect(blind.length).toBe(0);
    // مع سياق مطابق داخل معاملة = يرى صفاً واحداً فقط
    const seen = await withTenantPrisma(restricted, "t-seed", (tx) => tx.tenant.findMany({}));
    expect(seen.length).toBe(1);
    expect(seen[0]?.id).toBe("t-seed");
    // بعد انتهاء المعاملة: السياق لن يبقى في الجلسة (ثبت الدور لا يرى شيئاً)
    const afterTx = await restricted.$queryRawUnsafe<Array<unknown>>(`SELECT * FROM "tenants"`) as unknown[];
    expect(afterTx.length).toBe(0);
    await restricted.$disconnect();
  });

  it("عزل المستأجرين: معاملة A لا ترى صفوف B عبر findMany المقيد", async () => {
    const owner = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    await owner.$executeRawUnsafe(`INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ('t-a','A','h',false,NOW()),('t-b','B','h',false,NOW())`);
    const store = createPrismaAuthStore(owner);
    await store.putExternalIdentity({ identityId: "i-shared", issuer: "https://idp", subject: "user-1", createdAt: new Date().toISOString() });
    await store.putMembership({ membershipId: "m-a", identityId: "i-shared", tenantId: "t-a", role: "reader", status: "active", authorizationVersion: 1 });
    await store.putMembership({ membershipId: "m-b", identityId: "i-shared", tenantId: "t-b", role: "reader", status: "active", authorizationVersion: 1 });
    await owner.$disconnect();

    const restricted = await restrictedClient(adminUrl);
    const storeR = createPrismaAuthStore(restricted);
    expect((await storeR.getMembership("m-a", "t-a"))?.membershipId).toBe("m-a");
    // A لا يرى عضوية B حتى بمعرفها الصريح
    expect(await storeR.getMembership("m-a", "t-b")).toBeNull();
    // revokeSession من مستأجر خطأ لا تلغي شيئاً (على قاعدة حية)
    const owner2 = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    await owner2.$executeRawUnsafe(`INSERT INTO "sessions" ("id","token_hash","csrf_hash","browser_binding_hash","identity_id","membership_id","tenant_id","auth_method","permissions","authorization_version","idle_expires_at","absolute_expires_at","revoked_at") VALUES ('s1','h1','c1','b1','i-shared','m-a','t-a','oidc','[]'::jsonb,1,NOW(),NOW(),NULL)`);
    await owner2.$disconnect();
    expect(await storeR.revokeSession("s1", "t-b", new Date().toISOString())).toBe(false);
    expect(await storeR.revokeSession("s1", "t-a", new Date().toISOString())).toBe(true);
    await restricted.$disconnect();
  });

  it("منفذ pre-auth: جلسة تُقرأ بهاشها حصراً والهويات تُكتب عبر identity_write فقط", async () => {
    const restricted = await restrictedClient(adminUrl);
    const storeR = createPrismaAuthStore(restricted);
    // كتابة هوية عبر البوابة تعمل، وقراءة session بهاش غير موجود = null بلا خطأ
    await storeR.putExternalIdentity({ identityId: "i-x", issuer: "https://idp", subject: "x", createdAt: new Date().toISOString() });
    expect(await storeR.findSessionByHash("no-such-hash")).toBeNull();
    // مفتاح lookup خارج القائمة البيضاء يُرفض متزامناً قبل فتح المعاملة
    expect(() => withLookupPrisma(restricted, [["app.evil", "1"]], async () => undefined)).toThrow(/غير مسموح/u);
    await restricted.$disconnect();
  });

  it("دخول متكرر: إعادة كتابة الهوية الداخلية تنجح — لا قيد فريد في الدخول الثاني", async () => {
    const restricted = await restrictedClient(adminUrl);
    const storeR = createPrismaAuthStore(restricted);
    const record = { identityId: "internal:cred-repeat", issuer: "urn:agentbridge:internal", subject: "cred-repeat", createdAt: new Date().toISOString() };
    // الأول يُنشئ الصف، والثاني يجب أن يُحدّثه لا يصطدم بقيد (issuer,subject)
    // — انحدار عيب: سياسة SELECT الداخلية تتطلب app.credential_id فكان
    // التحديث يرى صفر صفوف ويفشل الدخول الثاني بالوضع الحي
    await storeR.putExternalIdentity(record);
    await expect(storeR.putExternalIdentity({ ...record, createdAt: new Date().toISOString() })).resolves.toBeUndefined();
    // والصف بلا مكرر — العد بعميل المالك (فوق RLS) لا بالدور المقيد
    const adminCounter = new PrismaClient({ datasources: { db: { url: adminUrl } } });
    try {
      const rows = await adminCounter.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "external_identities" WHERE subject = 'cred-repeat'`) as Array<{ id: string }>;
      expect(rows.length).toBe(1);
    } finally {
      await adminCounter.$disconnect();
    }
    await restricted.$disconnect();
  });

  it("upgrade: الهجرة idempotent — إعادة deploy على قاعدة مهاجرة لا تفشل", () => {
    expect(() => deployMigrations(database)).not.toThrow();
  });
});
