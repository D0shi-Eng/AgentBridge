/**
 * حالات الدور 1..9 و15 على قاعدة مكتملة الهجرات.
 * كل رفض يتحقق برمزه الثابت لا بtoThrow عامة؛ الحالة 15 تحكم سلبي القاعدة
 * الفارغة: نتيجتها AB_TABLE_MISSING (جدول غير موجود) لا mismatch أمني.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertRestrictedRole } from "@agentbridge/infra";
import { createMigratedDb, liveUp, listApplied, ALL_MIGRATIONS } from "./upgrade-harness.js";
import {
  RUN_ID, adminClient, adminCredentials, cleanupTracked, createNoLoginRole,
  dirtyExecCaseOf, expectCode, grantMembership, provisionCleanLogin,
  restrictedClientWith, type RoleCaseContext,
} from "./restricted-role-helpers.js";

const databases: string[] = [];
const ctx: { current: RoleCaseContext | null } = { current: null };

beforeAll(async () => {
  if (!liveUp) return;
  const migrated = await createMigratedDb();
  databases.push(migrated.database);
  ctx.current = migrated;
}, 240_000);

afterAll(async () => {
  await cleanupTracked(databases);
});

describe.skipIf(!liveUp)("حالات الدور 1..9 و15 على قاعدة مكتملة الهجرات", () => {
  it("حالة 1 (إيجابية): الإعداد الصحيح ينجح ويثبت هوية الطرفين", { timeout: 60_000 }, async () => {
    const context = ctx.current!;
    await expect(listApplied(context.database)).resolves.toHaveLength(ALL_MIGRATIONS.length);
    const { role, password } = await provisionCleanLogin(context, "pos");
    const client = restrictedClientWith(role, password, context.database, "-c%20role%3Dagentbridge_app");
    await expect(assertRestrictedRole(client)).resolves.toBeUndefined();
    const persona = await client.$queryRawUnsafe<Array<{ s: string; c: string }>>("SELECT session_user AS s, current_user AS c");
    expect(persona[0]?.s).toBe(role);
    expect(persona[0]?.c).toBe("agentbridge_app");
    await client.$disconnect();
  });

  it("حالة 2: current role خاطئ نظيف الصفات ⇒ AB_ROLE_EXEC_MISMATCH", { timeout: 60_000 }, async () => {
    const context = ctx.current!;
    const { role, password } = await provisionCleanLogin(context, "wrongexec");
    const configRole = await createNoLoginRole(context, "cfgwrong", "");
    await grantMembership(context.adminUrl, configRole, role);
    const client = restrictedClientWith(role, password, context.database, `-c%20role%3D${configRole}`);
    await expectCode(assertRestrictedRole(client), "AB_ROLE_EXEC_MISMATCH");
    await client.$disconnect();
  });

  it("حالة 3: حذف role options (بلا options) ⇒ AB_ROLE_EXEC_MISMATCH", { timeout: 60_000 }, async () => {
    const context = ctx.current!;
    const { role, password } = await provisionCleanLogin(context, "noopts");
    const client = restrictedClientWith(role, password, context.database);
    await expectCode(assertRestrictedRole(client), "AB_ROLE_EXEC_MISMATCH");
    await client.$disconnect();
  });

  it("حالة 4: session_user خارق (superuser) مع options ⇒ AB_ROLE_ATTR_SESSION", { timeout: 60_000 }, async () => {
    const { user, password } = adminCredentials();
    const client = restrictedClientWith(user, password, ctx.current!.database, "-c%20role%3Dagentbridge_app");
    await expectCode(assertRestrictedRole(client), "AB_ROLE_ATTR_SESSION");
    await client.$disconnect();
  });

  it("حالة 5: الدور التنفيذي يحمل BYPASSRLS ⇒ AB_ROLE_ATTR_EXEC", { timeout: 60_000 }, async () => {
    await dirtyExecCaseOf(ctx.current!, "bp", "BYPASSRLS");
  });

  it("حالة 6: الدور التنفيذي CREATEDB ⇒ AB_ROLE_ATTR_EXEC", { timeout: 60_000 }, async () => {
    await dirtyExecCaseOf(ctx.current!, "db", "CREATEDB");
  });

  it("حالة 7: الدور التنفيذي CREATEROLE ⇒ AB_ROLE_ATTR_EXEC", { timeout: 60_000 }, async () => {
    await dirtyExecCaseOf(ctx.current!, "role", "CREATEROLE");
  });

  it("حالة 8: عضوية مباشرة في دور خارق ⇒ AB_ROLE_MEMBERSHIP", { timeout: 60_000 }, async () => {
    const context = ctx.current!;
    const { role, password } = await provisionCleanLogin(context, "dirmember");
    const danger = await createNoLoginRole(context, "dirdanger", "CREATEROLE");
    await grantMembership(context.adminUrl, danger, role);
    const client = restrictedClientWith(role, password, context.database, "-c%20role%3Dagentbridge_app");
    await expectCode(assertRestrictedRole(client), "AB_ROLE_MEMBERSHIP");
    await client.$disconnect();
  });

  it("حالة 9: عضوية غير مباشرة (سلسلة دورين) ⇒ AB_ROLE_MEMBERSHIP", { timeout: 60_000 }, async () => {
    const context = ctx.current!;
    const { role, password } = await provisionCleanLogin(context, "indmember");
    const danger = await createNoLoginRole(context, "inddanger", "CREATEROLE");
    const middle = await createNoLoginRole(context, "indmid", "NOINHERIT");
    await grantMembership(context.adminUrl, danger, middle);
    await grantMembership(context.adminUrl, middle, role);
    const client = restrictedClientWith(role, password, context.database, "-c%20role%3Dagentbridge_app");
    await expectCode(assertRestrictedRole(client), "AB_ROLE_MEMBERSHIP");
    await client.$disconnect();
  });

  it("حالة 15 (تحكم سلبي): قاعدة فارغة تفشل AB_TABLE_MISSING لا mismatch أمني", { timeout: 60_000 }, async () => {
    const context = ctx.current!;
    const empty = `ab_empty_${RUN_ID}`;
    const admin = adminClient(context.database);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${JSON.stringify(empty)}`);
    await admin.$disconnect();
    databases.push(empty);
    const { role, password } = await provisionCleanLogin(context, "emptychk");
    const admin2 = adminClient(context.database);
    await admin2.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${JSON.stringify(empty)} TO ${JSON.stringify(role)}`);
    await admin2.$disconnect();
    // البرهان: الفشل على القاعدة الفارغة بسبب جداول مفقودة — لذا أي «إثبات
    // دور خاطئ» على قاعدة بلا هجرات لاغٍ
    const client = restrictedClientWith(role, password, empty, "-c%20role%3Dagentbridge_app");
    await expectCode(assertRestrictedRole(client), "AB_TABLE_MISSING");
    await client.$disconnect();
  });
});
