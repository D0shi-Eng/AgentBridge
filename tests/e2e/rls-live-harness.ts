/**
 * عدة التشغيل الحي المشتركة — قاعدة مؤقتة + هجرة + دور تشغيل مقيد.
 * قاعدة العزل: لا حساب عالمي واحد تتسابق ملفات الاختبار على كلمة مروره —
 * كل نداء provisionRestrictedRole يولد دور LOGIN باسم فريد للعملية وكلمة مرور
 * عشوائية للجلسة، ويسجل في سجل يُمسح مع القاعدة المؤقتة (cleanup مضمون).
 * العناوين من مصدر واحد (live-config) — لا hardcode موزع لـlocalhost.
 */
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { LIVE_DATABASE_URL } from "./live-config.js";
import { migrateDeployAt, REAL_MIGRATIONS_DIR } from "./prisma-cli.js";

/** عنوان المالك (الهجرة/البذر/الإدارة) — لا تشغيل اختبارات به إطلاقاً */
export const ADMIN_URL = LIVE_DATABASE_URL;

/** أدوار LOGIN المؤقتة المسجلة لكل قاعدة — تُسقط مع إسقاط القاعدة */
const provisionedRoles = new Map<string, string[]>();

/** يسجل دوراً مؤقتاً (مالك مخصص مثلاً) ليُسقط مع القاعدة تلقائياً */
export function registerEphemeralRole(database: string, role: string): void {
  const roles = provisionedRoles.get(database) ?? [];
  roles.push(role);
  provisionedRoles.set(database, roles);
}

/** عميل المالك خام بلا role override — للهجرة والبذر حصراً */
export function ownerPrisma(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasources: { db: { url: databaseUrl } } });
}

/** عميل بدور تشغيل مقيد — الاتصال يفتح بدور agentbridge_app عبر options
 * (بمسافة حرفية لا %20 — الترميز المئوي يفشل عبر Prisma pool). */
export function restrictedPrisma(databaseUrl: string): PrismaClient {
  const separator = databaseUrl.includes("?") ? "&" : "?";
  return new PrismaClient({ datasources: { db: { url: `${databaseUrl}${separator}options=-c role=agentbridge_app` } } });
}

async function probe(url: string): Promise<boolean> {
  const probeClient = new PrismaClient({ datasources: { db: { url: `${url}${url.includes("?") ? "&" : "?"}connect_timeout=2` } } });
  try { await probeClient.$queryRaw`SELECT 1`; return true; } catch { return false; } finally { await probeClient.$disconnect(); }
}

export const liveAvailable = await probe(ADMIN_URL);
if (!liveAvailable) {
  console.info("[تخطٍّ موثق] الشوط الحي المقيد: لا قاعدة PostgreSQL على العنوان المضبوط — أقلع docker-compose.dev.yaml أو اضبط AB_LIVE_DATABASE_URL");
}

/** ينشئ قاعدة مؤقتة ويعيد اسمها وعنوان المالك للاتصال بها */
export async function createEphemeralDatabase(): Promise<{ database: string; adminUrl: string }> {
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  const database = `ab_upg_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await admin.$executeRawUnsafe(`CREATE DATABASE ${JSON.stringify(database)}`);
  await admin.$disconnect();
  const adminUrl = `${ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/u, "")}/${database}`;
  return { database, adminUrl };
}

/** يسقط القاعدة وأي دور LOGIN مُجهز لها — cleanup مضمون عند المستدعي */
export async function dropEphemeralDatabase(database: string): Promise<void> {
  const roles = provisionedRoles.get(database) ?? [];
  provisionedRoles.delete(database);
  const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${JSON.stringify(database)} WITH (FORCE)`);
  for (const role of roles) {
    // إسقاط الدور بعد القاعدة: بلا تبعيات متبقية عليه (CONNECT مات مع القاعدة)
    await admin.$executeRawUnsafe(`DROP ROLE IF EXISTS ${JSON.stringify(role)}`).catch(() => {});
  }
  await admin.$disconnect();
}

/** deploy الهجرات عبر Prisma CLI بلا shell — فشل صريح عند أي إشارة خاسرة */
export function deployMigrations(databaseUrl: string): void {
  migrateDeployAt(databaseUrl, REAL_MIGRATIONS_DIR);
}

/**
 * يجهز دور تشغيل مقيد فريداً داخل قاعدة الاختبار المؤقتة:
 * LOGIN NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT/NOBYPASSRLS عضو
 * بـagentbridge_app؛ userinfo=الدور الجديد وoptions=-c role=agentbridge_app.
 * يعيد عنوان الاتصال المقيد — والاسم مسجل للتنظيف مع القاعدة.
 */
export async function provisionRestrictedRole(adminUrl: string, database: string): Promise<string> {
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  const role = `ab4_r_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const password = `pw_${randomUUID().replaceAll("-", "")}`;
  const escaped = password.replaceAll("'", "''");
  await admin.$executeRawUnsafe(
    `CREATE ROLE ${JSON.stringify(role)} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD '${escaped}'`);
  await admin.$executeRawUnsafe(`GRANT agentbridge_app TO ${JSON.stringify(role)}`);
  await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${JSON.stringify(database)} TO ${JSON.stringify(role)}`);
  await admin.$disconnect();
  const roles = provisionedRoles.get(database) ?? [];
  roles.push(role);
  provisionedRoles.set(database, roles);
  // userinfo = الدور الفريد الجديد؛ الدور التنفيذي عبر options حصراً —
  // أي خلط بين userinfo وrole override يكسر حصرية الحساب المقيد
  const noUserInfo = adminUrl.replace(/^[a-z]+:\/\/[^/]+@/u, "");
  const hostOnly = noUserInfo.replace(/\/[^/?]+(\?.*)?$/u, "");
  const host = hostOnly.replace("postgresql://", "");
  return `postgresql://${role}:${encodeURIComponent(password)}@${host}/${database}?options=-c role=agentbridge_app`;
}

/** بذر أصلي بسيط بمالك الجداول — للمستأجرين حصراً (لا تشغيل اختبارات به) */
export async function seedViaOwner(adminUrl: string, tenants: Array<{ id: string; name: string }>): Promise<void> {
  const owner = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  for (const tenant of tenants) {
    await owner.$executeRawUnsafe(
      `INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ($1,$2,'seed-hash',false,NOW())`,
      tenant.id, tenant.name,
    );
  }
  await owner.$disconnect();
}
