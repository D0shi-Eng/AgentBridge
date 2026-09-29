/**
 * فحص الجداول المحمية fail-closed قبل أي استعلام عمل.
 *
 * ما يؤكده لكل اسم في PROTECTED_TABLES بلا استثناء:
 *  - الجدول موجود (استعلام وجود صريح لكل اسم — الاستعلام القديم بـIN كان
 *    يترك الجدول المفقود يختفي بصمت من النتيجة).
 *  - RLS مفعلة وFORCE مفعلة وسياسة واحدة على الأقل موجودة.
 *  - دور التطبيق (التنفيذي أو الجلسة أو سلسلتهما) ليس مالك الجدول.
 *  - المالك دور منفصل نظيف الصفات (migration/owner role) لا خارق.
 * يعيد قائمة أدوار المالكين ليفحصها فحص السلسلة في prisma-scope-role.
 */
import type { PrismaClient } from "@prisma/client";
import { RestrictedRoleError } from "./prisma-scope-role.js";

/** الجداول المحمية الإلزامية السبعة عشر — غياب أي منها يمنع الإقلاع.
 * يتضمن certificate_revocations بنفس ضوابط RLS/FORCE. */
export const PROTECTED_TABLES: readonly string[] = [
  "tenants", "projects", "specs", "pipelines", "certificates", "artifacts",
  "llm_spend", "memory_embeddings", "flywheel_lessons", "audit_log",
  "sso_configs", "memberships", "api_credentials", "sessions",
  "login_transactions", "external_identities", "certificate_revocations",
];

interface TableState {
  readonly relname: string;
  readonly tableowner: string;
  readonly relrowsecurity: boolean;
  readonly relforcerowsecurity: boolean;
  readonly policy_count: number;
}

/**
 * يفحص الجداول المحمية كلها ويعيد أدوار المالكين. أي نقص/خلل = رفض برمز ثابت.
 * ملاحظة أمنية: فحص كل جدول باستعلام وجود مستقل يمنع الاختفاء الصامت.
 */
export async function assertProtectedTables(client: PrismaClient): Promise<readonly string[]> {
  const ownerRoles: string[] = [];
  for (const table of PROTECTED_TABLES) {
    const rows = await client.$queryRawUnsafe<Array<TableState>>(
      `SELECT c.relname, t.tableowner,
              c.relrowsecurity, c.relforcerowsecurity,
              (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
         FROM pg_class c
         JOIN pg_tables t ON t.schemaname = 'public' AND t.tablename = c.relname
        WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname = $1`,
      table,
    );
    const state = rows[0];
    if (state === undefined) {
      throw new RestrictedRoleError("AB_TABLE_MISSING", `الجدول المحمي ${table} غير موجود — رفض إقلاع`);
    }
    if (state.relrowsecurity === false) {
      throw new RestrictedRoleError("AB_TABLE_NO_RLS", `الجدول ${table} بلا RLS مفعلة`);
    }
    if (state.relforcerowsecurity === false) {
      throw new RestrictedRoleError("AB_TABLE_NO_FORCE", `الجدول ${table} بلا FORCE ROW LEVEL SECURITY`);
    }
    if (state.policy_count === 0) {
      throw new RestrictedRoleError("AB_TABLE_NO_POLICY", `الجدول ${table} بلا أي سياسة RLS`);
    }
    await assertTableOwner(client, table, state.tableowner, ownerRoles);
  }
  return ownerRoles;
}

/** المالك دور منفصل نظيف — ليس طرفي الاتصال ولا خارقاً */
async function assertTableOwner(client: PrismaClient, table: string, owner: string, ownerRoles: string[]): Promise<void> {
  const roles = await client.$queryRawUnsafe<Array<{
    rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean;
    session_user: string; current_user: string;
  }>>(
    `SELECT o.rolname, o.rolsuper, o.rolbypassrls, o.rolcanlogin,
            (SELECT session_user) AS session_user, (SELECT current_user) AS current_user
       FROM pg_roles o WHERE o.rolname = $1`,
    owner,
  );
  const ownerRole = roles[0];
  if (ownerRole === undefined) {
    throw new RestrictedRoleError("AB_TABLE_OWNER_INVALID", `مالك الجدول ${table} (${owner}) ليس دوراً معرفاً`);
  }
  if (ownerRole.rolsuper || ownerRole.rolbypassrls) {
    throw new RestrictedRoleError("AB_TABLE_OWNER_INVALID",
      `مالك الجدول ${table} (${owner}) خارق الصفات (superuser/bypassrls) — لا يصلح مالكاً منفصلاً`);
  }
  if (ownerRole.rolname === ownerRole.current_user || ownerRole.rolname === ownerRole.session_user) {
    throw new RestrictedRoleError("AB_TABLE_OWNER_APP",
      `دور التشغيل (${ownerRole.rolname}) مالك الجدول المحمي ${table} — يتجاوز RLS بنيوياً`);
  }
  if (!ownerRoles.includes(owner)) ownerRoles.push(owner);
}
