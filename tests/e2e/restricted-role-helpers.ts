/**
 * بنية اختبارات الأدوار السلبية/الإيجابية — قواعد العزل:
 * أدوار LOGIN فريدة لكل حالة (اسم + runId معقم) وكلمة مرور عشوائية للجلسة،
 * لا كلمات مرور حرفية، ولا اعتماد على ترتيب Vitest؛ التنظيف مسجل دائماً.
 */
import { randomUUID } from "node:crypto";
import { expect } from "vitest";
import { RestrictedRoleError } from "@agentbridge/infra";
import { PrismaClient } from "@prisma/client";
import { dropEphemeralDatabase } from "./rls-live-harness.js";
import { ADMIN_URL, dbUrl } from "./upgrade-harness.js";

/** لاحقة فريدة لهذه العملية — أسماء الأدوار لا تتسابق بين ملفات متوازية */
export const RUN_ID = randomUUID().replaceAll("-", "").slice(0, 10);

/** كلمة مرور عشوائية للجلسة الواحدة — لا حرفية في المصدر */
export function sessionPassword(): string {
  return `pw_${randomUUID().replaceAll("-", "")}`;
}

/** اسم دور فريد باسم الحالة — معقم لأحرف PostgreSQL الآمنة */
export function caseRoleName(caseTag: string): string {
  const tag = caseTag.replaceAll(/[^a-z0-9_]/giu, "").slice(0, 20);
  return `ab4_${tag}_${RUN_ID}`;
}

/** host:port مشتق من مصدر الإعداد الواحد — لا hardcode لـlocalhost هنا */
export function hostOfDb(): string {
  const noUserInfo = ADMIN_URL.replace(/^[a-z]+:\/\/[^/]+@/u, "");
  return noUserInfo.replace(/\/.*$/u, "");
}

/** اعتماد حساب المالك مشتقة من مصدر الإعداد — لا كتابة حرفية في الاختبارات */
export function adminCredentials(): { user: string; password: string } {
  const url = new URL(ADMIN_URL);
  return { user: url.username, password: url.password };
}

/** اتصال حي بطرف (user/password/db/options) — options ترميز مئوي اختياري */
export function restrictedClientWith(user: string, password: string, db: string, options?: string): PrismaClient {
  const url = `postgresql://${user}:${encodeURIComponent(password)}@${hostOfDb()}/${db}${options === undefined ? "" : `?options=${options}`}`;
  return new PrismaClient({ datasources: { db: { url } } });
}

/** عميل المالك على قاعدة معينة — للإدارة والبذر فقط (لا تشغيل فحوص به) */
export function adminClient(db: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: dbUrl(db) } } });
}

const trackedRoles: string[] = [];

/** ينشئ دور LOGIN بصفات محددة وكلمة عشوائية ويسجله للتنظيف الإجباري */
export async function provisionCaseRole(rolname: string, attributes: string, database: string): Promise<string> {
  const admin = adminClient(database);
  const password = sessionPassword();
  await admin.$executeRawUnsafe(`CREATE ROLE ${JSON.stringify(rolname)} ${attributes} LOGIN PASSWORD '${password.replaceAll("'", "''")}'`);
  await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${JSON.stringify(database)} TO ${JSON.stringify(rolname)}`);
  await admin.$disconnect();
  trackedRoles.push(rolname);
  return password;
}

/** يمنح عضوية من دور إلى آخر عبر المالك (لحالات السلاسل المباشرة وغير المباشرة) */
export async function grantMembership(adminUrl: string, role: string, member: string): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  await admin.$executeRawUnsafe(`GRANT ${JSON.stringify(role)} TO ${JSON.stringify(member)}`);
  await admin.$disconnect();
}

/** يسقط الأدوار المتتبعة والقواعد المؤقتة — يُستدعى في afterAll دائماً.
 * الترتيب مقصود: القواعد المؤقتة أولاً (فات صلاحيات CONNECT تمنع الإسقاط)،
 * مع سحب كل عضويات الدور (الاتجاهين) قبل DROP ROLE؛ فشل يُجمع ويُرمى —
 * لا ابتلاع صامت (قاعدة الـcatch). */
export async function cleanupTracked(databases: readonly string[]): Promise<void> {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  const failures: string[] = [];
  for (const database of databases) await dropEphemeralDatabase(database);
  for (const role of trackedRoles.splice(0)) {
    try {
      const memberships = await admin.$queryRawUnsafe<Array<{ roleid: string; member: string }>>(
        `SELECT r.rolname AS roleid, m.rolname AS member FROM pg_auth_members a
           JOIN pg_roles r ON r.oid = a.roleid JOIN pg_roles m ON m.oid = a.member
          WHERE m.rolname = $1 OR r.rolname = $1`, role);
      for (const membership of memberships) {
        await admin.$executeRawUnsafe(`REVOKE ${JSON.stringify(membership.roleid)} FROM ${JSON.stringify(membership.member)}`);
      }
      await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${JSON.stringify(role)}`);
    } catch (error) {
      failures.push(`دور ${role}: ${String((error as Error).message).replace(/\s+/u, " ").slice(0, 140)}`);
    }
  }
  await admin.$disconnect();
  if (failures.length > 0) throw new Error(`تنظيف غير مكتمل — ${failures.join(" | ")}`);
}

// ---------- مساعدات حالات الدور — تستقبل سياق القاعدة ----------

export interface RoleCaseContext { readonly database: string; readonly adminUrl: string }

/** رمز الرفض المتوقع من اختبار fail-closed — يفشل إن لم يكن RestrictedRoleError */
export async function expectCode(run: Promise<unknown>, code: string): Promise<void> {
  try {
    await run;
    throw new Error(`نجح غير مقصود — توقعت ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(RestrictedRoleError);
    expect((error as RestrictedRoleError).code).toBe(code);
  }
}

/** دور LOGIN نظيف عضو بالدور التنفيذي — الإعداد الصحيح المرجعي */
export async function provisionCleanLogin(ctx: RoleCaseContext, tag: string): Promise<{ role: string; password: string }> {
  const role = caseRoleName(tag);
  const password = await provisionCaseRole(role, "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS", ctx.database);
  await grantMembership(ctx.adminUrl, "agentbridge_app", role);
  return { role, password };
}

/** ينشئ دوراً تنفيذياً NOLOGIN بصفة خارقة واحدة مرتبطاً بدور LOGIN نظيف */
export async function provisionDirtyExec(ctx: RoleCaseContext, tag: string, attribute: string): Promise<{ login: string; password: string; exec: string }> {
  const login = caseRoleName(`${tag}login`);
  const exec = caseRoleName(`${tag}exec`);
  const password = await provisionCaseRole(login, "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS", ctx.database);
  const admin = adminClient(ctx.database);
  await admin.$executeRawUnsafe(`CREATE ROLE ${JSON.stringify(exec)} NOLOGIN ${attribute}`);
  await admin.$executeRawUnsafe(`GRANT ${JSON.stringify(exec)} TO ${JSON.stringify(login)}`);
  await admin.$disconnect();
  return { login, password, exec };
}

/** ينشئ دور NOLOGIN بصفات اختيارية ويسجله للتنظيف */
export async function createNoLoginRole(ctx: RoleCaseContext, tag: string, attributes: string): Promise<string> {
  const role = caseRoleName(tag);
  const admin = adminClient(ctx.database);
  await admin.$executeRawUnsafe(`CREATE ROLE ${JSON.stringify(role)} NOLOGIN ${attributes}`.trim());
  await admin.$disconnect();
  trackedRoles.push(role);
  return role;
}

/** حالة دور تنفيذي خارق: اتصال بخيار الدور الخارق ثم التحقق من رمز الرفض */
export async function dirtyExecCaseOf(ctx: RoleCaseContext, tag: string, attribute: string, code = "AB_ROLE_ATTR_EXEC"): Promise<void> {
  const { assertRestrictedRole } = await import("@agentbridge/infra");
  const { login, password, exec } = await provisionDirtyExec(ctx, tag, attribute);
  const client = restrictedClientWith(login, password, ctx.database, `-c%20role%3D${exec}`);
  await expectCode(assertRestrictedRole(client), code);
  await client.$disconnect();
}
