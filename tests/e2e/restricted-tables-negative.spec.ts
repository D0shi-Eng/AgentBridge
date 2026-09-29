/**
 * حالات الجداول المحمية 10..14.
 * كل حالة على قاعدة مكتملة الهجرات مستقلة تُعدَّل عمداً بأذى واحد؛
 * الرفض يتحقق برمزه الثابت: MISSING / NO_RLS / NO_FORCE / NO_POLICY / OWNER_APP.
 */
import { afterAll, describe, expect, it } from "vitest";
import { assertRestrictedRole, RestrictedRoleError } from "@agentbridge/infra";
import { createMigratedDb, liveUp } from "./upgrade-harness.js";
import {
  adminClient, caseRoleName, cleanupTracked, grantMembership,
  provisionCaseRole, restrictedClientWith,
} from "./restricted-role-helpers.js";

const databases: string[] = [];

afterAll(async () => {
  await cleanupTracked(databases);
});

interface CaseContext { database: string; adminUrl: string; role: string; password: string }

/** قاعدة مكتملة الهجرات + دور تشغيل نظيف لكل حالة — العزل يمنع تلوث الحالات */
async function prepareCase(tag: string): Promise<CaseContext> {
  const { database, adminUrl } = await createMigratedDb();
  databases.push(database);
  const role = caseRoleName(tag);
  const password = await provisionCaseRole(role, "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS", database);
  await grantMembership(adminUrl, "agentbridge_app", role);
  return { database, adminUrl, role, password };
}

function clientFor(context: CaseContext) {
  return restrictedClientWith(context.role, context.password, context.database, "-c%20role%3Dagentbridge_app");
}

async function expectCode(run: Promise<unknown>, code: string): Promise<void> {
  try {
    await run;
    throw new Error(`نجح غير مقصود — توقعت ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RestrictedRoleError);
    expect((error as RestrictedRoleError).code).toBe(code);
  }
}

describe.skipIf(!liveUp)("حالات الجداول المحمية 10..14", () => {
  it("حالة 10: جدول محمي مفقود ⇒ AB_TABLE_MISSING (لا اختفاء صامت)", { timeout: 90_000 }, async () => {
    const context = await prepareCase("missing");
    const admin = adminClient(context.database);
    await admin.$executeRawUnsafe(`DROP TABLE "certificates"`);
    await admin.$disconnect();
    await expectCode(assertRestrictedRole(clientFor(context)), "AB_TABLE_MISSING");
    await clientFor(context).$disconnect();
  });

  it("حالة 11: جدول بلا RLS ⇒ AB_TABLE_NO_RLS", { timeout: 90_000 }, async () => {
    const context = await prepareCase("norls");
    const admin = adminClient(context.database);
    await admin.$executeRawUnsafe(`ALTER TABLE "projects" DISABLE ROW LEVEL SECURITY`);
    await admin.$disconnect();
    await expectCode(assertRestrictedRole(clientFor(context)), "AB_TABLE_NO_RLS");
    await clientFor(context).$disconnect();
  });

  it("حالة 12: جدول بلا FORCE RLS ⇒ AB_TABLE_NO_FORCE", { timeout: 90_000 }, async () => {
    const context = await prepareCase("noforce");
    const admin = adminClient(context.database);
    await admin.$executeRawUnsafe(`ALTER TABLE "specs" NO FORCE ROW LEVEL SECURITY`);
    await admin.$disconnect();
    await expectCode(assertRestrictedRole(clientFor(context)), "AB_TABLE_NO_FORCE");
    await clientFor(context).$disconnect();
  });

  it("حالة 13: جدول بلا سياسة ⇒ AB_TABLE_NO_POLICY", { timeout: 90_000 }, async () => {
    const context = await prepareCase("nopol");
    const admin = adminClient(context.database);
    await admin.$executeRawUnsafe(`DROP POLICY "tenant_isolation" ON "pipelines"`);
    await admin.$disconnect();
    await expectCode(assertRestrictedRole(clientFor(context)), "AB_TABLE_NO_POLICY");
    await clientFor(context).$disconnect();
  });

  it("حالة 14: دور التطبيق مالك جدول محمي ⇒ AB_TABLE_OWNER_APP", { timeout: 90_000 }, async () => {
    const context = await prepareCase("appowner");
    const admin = adminClient(context.database);
    await admin.$executeRawUnsafe(`ALTER TABLE "audit_log" OWNER TO agentbridge_app`);
    await admin.$disconnect();
    await expectCode(assertRestrictedRole(clientFor(context)), "AB_TABLE_OWNER_APP");
    await clientFor(context).$disconnect();
  });
});
