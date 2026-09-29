/**
 * هارنس الترقية الموحد — المصدر الوحيد لدورة حياة
 * قواعد الاختبار المؤقتة وdeploy الهجرات والجذور المؤقتة. يوحّد الاختبارات
 * القديمة والجديدة فوق prisma-cli (بلا shell) وrls-live-harness (دورة الحياة)
 * دون إخفاء تاريخ الفشل: السجلات الفاشلة تبقى بأسمائها.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { ADMIN_URL, createEphemeralDatabase } from "./rls-live-harness.js";
import { REAL_MIGRATIONS_DIR, migrateDeployAt, assertInsideTmpdir } from "./prisma-cli.js";

// دورة حياة القواعد المؤقتة — مصدر واحد لا نسخ مكررة
export { ADMIN_URL, liveAvailable as liveUp, createEphemeralDatabase as createUpgradeDb, dropEphemeralDatabase } from "./rls-live-harness.js";
// تشغيل Prisma والجذور المؤقتة — بلا shell حصراً
export {
  buildTemporaryRoot, fileSha256, migrateDeployAt, assertInsideTmpdir,
  MigrationCliError, runPrismaCli, REAL_MIGRATIONS_DIR, REAL_SCHEMA_PATH,
} from "./prisma-cli.js";

/** ترتيب الهجرات التاريخية الخمس — لا تُعدل ولا تُعاد كتابتها أبداً */
export const HISTORICAL = [
  "20260825135637_init",
  "20260831000000_add_llm_spend",
  "20260901000000_add_memory_embeddings",
  "20260902000000_add_flywheel_lessons",
  "20260905030000_trusted_identity_isolation",
] as const;
export const RLS_MIGRATION = "20260907160000_rls_and_cas";
export const SSO_INSTANCE_MIGRATION = "20260907200000_sso_instance_and_identity_policy";
export const LOGIN_TX_MIGRATION = "20260912000000_login_tx_instance_not_null";
/** هجرة الأرشيف الدائم (بسياسات RLS ومنح الدور المقيد) */
export const RUN_ARCHIVES_MIGRATION = "20260918000000_run_state_archives";

/** كل الهجرات الاثنتا عشرة بالترتيب — سيناريو fresh المرجعي */
export const REVOCATIONS_MIGRATION = "20260920030000_certificate_revocations";
export const TENANT_LIFECYCLE_MIGRATION = "20260920200000_tenant_lifecycle";
export const TENANT_DELETION_MIGRATION = "20260921030000_tenant_deletion_operations";
export const ALL_MIGRATIONS: readonly string[] = [...HISTORICAL, RLS_MIGRATION, SSO_INSTANCE_MIGRATION, LOGIN_TX_MIGRATION, RUN_ARCHIVES_MIGRATION, REVOCATIONS_MIGRATION, TENANT_LIFECYCLE_MIGRATION, TENANT_DELETION_MIGRATION];

/** قاعدة مؤقتة جديدة مكتملة الهجرات — الحالة الإلزامية لاختبارات الدور.
 * بعد deploy تنقل الملكية إلى دور مالك منفصل غير خارق — مطابقة لوضع الإنتاج
 * الموثق (دور مالك NOLOGIN غير خارق) كي يقيس فحص الإقلاع الصارم الوضع الحقيقي لا استثناءً. */
export async function createMigratedDb(): Promise<{ database: string; adminUrl: string }> {
  const { database, adminUrl } = await createEphemeralDatabase();
  migrateDeployAt(adminUrl, REAL_MIGRATIONS_DIR);
  await dedicateOwnerRole(adminUrl, database);
  return { database, adminUrl };
}

/** اسم قاعدة مؤقتة جديد مع حارس نوع: اسماً نصياً مطابقاً للنمط لا كائناً —
 * تسرب كائن في عنوان القاعدة أنشأ يوماً قاعدة حرفية «[object Object]»
 * واندمجت فيها سيناريوهات مستقلة زائفاً؛ هذا الحارس يجعل العودة مستحيلة. */
export async function freshDatabase(): Promise<string> {
  const { database } = await createEphemeralDatabase();
  if (!/^ab_upg_[a-z0-9]+$/u.test(database)) {
    throw new Error(`اسم قاعدة غير صالح: ${JSON.stringify(database)} — عقد الاسم مكسور`);
  }
  return database;
}

/** ينقل ملكية جداول public من bootstrap المهاجر إلى دور مالك NOLOGIN نظيف.
 * REASSIGN OWNED العام يصطدم بكائنات نظام (2BP01) — لذا النقل جدولاً جدولاً
 * على جداول public حصراً، مطابقاً لوضع الإنتاج الموثق (دور مالك NOLOGIN غير خارق). */
async function dedicateOwnerRole(adminUrl: string, database: string): Promise<void> {
  const { registerEphemeralRole } = await import("./rls-live-harness.js");
  const owner = `ab4_own_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  await admin.$executeRawUnsafe(
    `CREATE ROLE ${JSON.stringify(owner)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
  const tables = await admin.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner = CURRENT_USER`);
  for (const table of tables) {
    await admin.$executeRawUnsafe(`ALTER TABLE ${JSON.stringify(table.tablename)} OWNER TO ${JSON.stringify(owner)}`);
  }
  await admin.$disconnect();
  registerEphemeralRole(database, owner);
}

/** قراءة _prisma_migrations بالترتيب — أسماء + checksums + اكتمال */
export async function listApplied(database: string): Promise<Array<{ name: string; checksum: string | null; finished: boolean }>> {
  const client = new PrismaClient({ datasources: { db: { url: dbUrl(database) } } });
  try {
    const has = await client.$queryRawUnsafe<Array<{ n: number }>>(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_name='_prisma_migrations'");
    if (has[0]?.n === 0) return [];
    const rows = await client.$queryRawUnsafe<Array<{ migration_name: string; checksum: string | null; finished_at: Date | null }>>(
      "SELECT migration_name, checksum, finished_at FROM \"_prisma_migrations\" ORDER BY started_at");
    return rows.map((row) => ({ name: row.migration_name, checksum: row.checksum, finished: row.finished_at !== null }));
  } finally { await client.$disconnect(); }
}

/** عنوان قاعدة مؤقتة بالاسم على الحاوية الحية نفسها */
export function dbUrl(database: string): string {
  return ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/u, "") + "/" + database;
}

/** معرف قاعدة فريد باسم السيناريو — لا تصادم بين ملفات متوازية */
export function scenarioDbName(tag: string): string {
  return `ab_upg_${tag.replaceAll(/[^a-z0-9]/giu, "").slice(0, 12)}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

/** حذف جذر مؤقت بعد التحقق أنه داخل os.tmpdir() حصراً.
 * Windows يحتفظ بمقبض المجلد لحظة قصيرة بعد disconnect — نعيد المحاولة
 * بمهلة؛ فشل نهائي يرمى صريحاً لا يُبتلع (ممنوع catch فارغة). */
export function safeRemoveRoot(root: string): void {
  assertInsideTmpdir(root);
  const attempts = 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      rmSync(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === attempts) throw error;
      const wait = Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
      if (wait === "timed-out") continue;
    }
  }
}
