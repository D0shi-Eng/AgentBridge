/**
 * إثبات حي لسياسة identity_internal_lookup نفسها.
 * الاستبعاد الحاسم: البحث الداخلي ينجح وapp.identity_issuer/subject غير
 * مضبوطين إطلاقاً — فلا يمكن لidentity_exact_lookup أن تكون سبب النجاح؛
 * والسياسة تُستخرج من كتالوج PostgreSQL لا من كود.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { withLookupPrisma, withTenantPrisma } from "@agentbridge/infra";
import { createEphemeralDatabase, dropEphemeralDatabase, provisionRestrictedRole, restrictedPrisma, seedViaOwner } from "./rls-live-harness.js";
import { liveUp } from "./upgrade-harness.js";
import { REAL_MIGRATIONS_DIR, migrateDeployAt } from "./prisma-cli.js";

let prisma: PrismaClient | null = null;
let database = "";
let adminUrl = "";
const CRED_A = "cred-iso-a-0000000000";
const CRED_B = "cred-iso-b-0000000000";

beforeAll(async () => {
  if (!liveUp) return;
  const created = await createEphemeralDatabase();
  database = created.database;
  adminUrl = created.adminUrl;
  migrateDeployAt(adminUrl, REAL_MIGRATIONS_DIR);
  prisma = restrictedPrisma(await provisionRestrictedRole(adminUrl, database));
  await seedViaOwner(adminUrl, [{ id: "t-pol-a", name: "A" }]);
  // هويتان داخليتان عبر بوابة الكتابة (المالك للبذر فقط)
  const owner = (await import("./rls-live-harness.js")).ownerPrisma(adminUrl);
  await owner.$executeRawUnsafe(
    `INSERT INTO "external_identities" ("id","issuer","subject") VALUES ($1,'urn:agentbridge:internal',$2),($3,'urn:agentbridge:internal',$4)`,
    `internal:${CRED_A}`, CRED_A, `internal:${CRED_B}`, CRED_B);
  await owner.$disconnect();
}, 240_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (database !== "") await dropEphemeralDatabase(database);
});

function client(): PrismaClient {
  if (prisma === null) throw new Error("القاعدة الحية غير مهيأة");
  return prisma;
}

/** يعد صفوف الهويات الداخلية المرئية تحت GUCs معينة داخل معاملة pre-auth */
async function visibleInternalIds(settings: Array<readonly [string, string]>): Promise<string[]> {
  return withLookupPrisma(client(), settings, async (tx) => {
    const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "external_identities" WHERE issuer='urn:agentbridge:internal' ORDER BY id`);
    return rows.map((row) => row.id);
  });
}

describe.skipIf(!liveUp)("سياسة الهوية الداخلية حية", () => {
  it("1-3: A ترى A فقط، لا ترى B، وغياب السياق يعيد صفر صفوف", async () => {
    expect(await visibleInternalIds([["app.credential_id", CRED_A]])).toEqual([`internal:${CRED_A}`]);
    expect(await visibleInternalIds([["app.credential_id", CRED_B]])).toEqual([`internal:${CRED_B}`]);
    await expect(visibleInternalIds([])).rejects.toThrow(/فارغ/u);
  });

  it("4-6: credential مجهول يعيد صفراً، وtenant_id لا يوسع، وidentity_write لا يمنح SELECT أوسع", async () => {
    expect(await visibleInternalIds([["app.credential_id", "cred-anonymous-xxxxxxx"]])).toEqual([]);
    // tenant GUC وحده (أو مع credential لغير صاحب الصف) لا يفتح صفوف الآخرين
    expect(await visibleInternalIds([["app.tenant_id", "t-pol-a"]])).toEqual([]);
    expect(await visibleInternalIds([["app.tenant_id", "t-pol-a"], ["app.credential_id", CRED_B]]))
      .toEqual([`internal:${CRED_B}`]);
    // بوابة الكتابة (بعد الإصلاح) لم تعد تمنح قراءة شاملة — صفر صفوف بلا credential
    expect(await visibleInternalIds([["app.identity_write", "1"]])).toEqual([]);
    // والكتابة الإدارية ما تزال تعمل ببوابتها (INSERT ينجح بها)
    await withLookupPrisma(client(), [["app.identity_write", "1"]], async (tx) => {
      await tx.$executeRawUnsafe(
        `INSERT INTO "external_identities" ("id","issuer","subject") VALUES ('internal:cred-w-000000000','urn:agentbridge:internal','cred-w-000000000')`);
    });
  });

  it("7-8: خلط كل GUCs لا يسمح برؤية B", async () => {
    const mixed: Array<readonly [string, string]> = [
      ["app.identity_write", "1"], ["app.tenant_id", "t-pol-a"],
      ["app.identity_issuer", "urn:agentbridge:internal"], ["app.identity_subject", CRED_A],
      ["app.credential_id", CRED_A], ["app.session_hash", "x"], ["app.state_hash", "y"],
    ];
    const visible = await visibleInternalIds(mixed);
    expect(visible).not.toContain(`internal:${CRED_B}`);
  });

  it("9: السياق لا يتسرب بعد المعاملة (current_setting فارغ على العميل نفسه)", async () => {
    await withLookupPrisma(client(), [["app.credential_id", CRED_A]], async () => undefined);
    const rows = await client().$queryRawUnsafe<Array<{ v: string }>>(
      `SELECT current_setting('app.credential_id', true) AS v`);
    expect(rows[0]?.v).toBe("");
  });

  it("10-11: جلسان متزامنتان لهويتين مختلفتين لا تتداخلان", async () => {
    const [a, b] = await Promise.all([
      visibleInternalIds([["app.credential_id", CRED_A]]),
      visibleInternalIds([["app.credential_id", CRED_B]]),
    ]);
    expect(a).toEqual([`internal:${CRED_A}`]);
    expect(b).toEqual([`internal:${CRED_B}`]);
  });

  it("12-14: السياسة من الكتالوج هي identity_internal_lookup بالصيغة الصحيحة، وexact ليست سبب النجاح", async () => {
    // استخراج من كتالوج PostgreSQL لا من الكود
    const policies = await client().$queryRawUnsafe<Array<{ polname: string; qual: string }>>(
      `SELECT polname, pg_get_expr(polqual, polrelid)::text AS qual FROM pg_policy
        WHERE polrelid='external_identities'::regclass`);
    const internal = policies.find((entry) => entry.polname === "identity_internal_lookup");
    expect(internal).toBeDefined();
    // pg_get_expr يطبّع النوع (::text) — نطابق جوهر التعبير لا صياغته الحرفية
    expect(internal?.qual).toContain("'app.credential_id'");
    expect(internal?.qual).not.toContain("LIKE");
    // سياسة INSERT بلا USING فتكون polqual فارغة — نطبّع قبل الفحص
    expect(policies.some((entry) => (entry.qual ?? "").includes("internal:%"))).toBe(false);
    // الاستبعاد الحاسم: لا issuer/subject GUCs إطلاقاً — exact_lookup عاجزة،
    // فنجاح القراءة لا يمكن تفسيره إلا بidentity_internal_lookup
    const onlyCredential = await visibleInternalIds([["app.credential_id", CRED_A]]);
    expect(onlyCredential).toEqual([`internal:${CRED_A}`]);
    // وحالة tenant عبر withTenantPrisma لا تفتح الهويات الداخلية
    await withTenantPrisma(client(), "t-pol-a", async (tx) => {
      const rows = await tx.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM "external_identities"`);
      expect(rows[0]?.n).toBe(0);
    });
  });
});
