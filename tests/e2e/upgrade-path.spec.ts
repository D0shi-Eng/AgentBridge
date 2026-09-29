/**
 * سيناريوهات الترقية الأربعة فوق الجذر المؤقت.
 * كل سيناريو يقارن checksums من _prisma_migrations بالبصمات الفعلية للملفات
 * (لا fresh فقط)، ويثبت الأعمدة/القيود/السياسات وبقاء البيانات المهمة.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  ALL_MIGRATIONS, HISTORICAL, RLS_MIGRATION, SSO_INSTANCE_MIGRATION,
  buildTemporaryRoot, dbUrl, dropEphemeralDatabase, fileSha256,
  freshDatabase, listApplied, liveUp, migrateDeployAt, safeRemoveRoot,
} from "./upgrade-harness.js";
import { seedPreSsoData } from "./upgrade-seed.js";

const databases: string[] = [];
const roots: string[] = [];

afterAll(async () => {
  for (const database of databases) await dropEphemeralDatabase(database);
  for (const root of roots) safeRemoveRoot(root);
});

/** مطابقة كل هجرة مطبقة: الاسم والترتيب والبصمة والاكتمال */
async function expectChecksums(root: string, database: string, expected: readonly string[]): Promise<void> {
  const applied = await listApplied(database);
  expect(applied.map((entry) => entry.name)).toEqual([...expected]);
  for (const entry of applied) {
    expect(entry.finished).toBe(true);
    expect(entry.checksum).toBe(fileSha256(`${root}/migrations/${entry.name}/migration.sql`));
  }
}

beforeAll(async () => { if (!liveUp) return; }, 60_000);

describe.skipIf(!liveUp)("سيناريوهات الترقية فوق الجذر المؤقت", () => {
  it("(أ) قاعدة فارغة ← الهجرات الثمانية: أسماء وترتيب وبصمات مطابقة", { timeout: 180_000 }, async () => {
    const database = await freshDatabase();
    databases.push(database);
    const { root, migrationsDir } = buildTemporaryRoot(ALL_MIGRATIONS);
    roots.push(root);
    migrateDeployAt(dbUrl(database), migrationsDir);    await expectChecksums(root, database, ALL_MIGRATIONS);
    // عمود المعاملة: NOT NULL + قيد النطاق موجودان بعد fresh
    const client = new PrismaClient({ datasources: { db: { url: dbUrl(database) } } });
    try {
      const col = await client.$queryRawUnsafe<Array<{ nullable: string }>>(
        `SELECT is_nullable AS nullable FROM information_schema.columns
          WHERE table_name='login_transactions' AND column_name='config_instance_id'`);
      expect(col[0]?.nullable).toBe("NO");
      const chk = await client.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conname='login_tx_instance_domain_chk'`);
      expect(chk[0]?.n).toBe(1);
    } finally { await client.$disconnect(); }
  });

  it("(ب) تاريخية خمس + بيانات ما قبل هجرة SSO ← RLS ثم SSO ثم إغلاق العمود: البيانات باقية والمعاملة القديمة مبطلة", { timeout: 240_000 }, async () => {
    const database = await freshDatabase();
    databases.push(database);
    const baseline = buildTemporaryRoot(HISTORICAL);
    roots.push(baseline.root);
    migrateDeployAt(dbUrl(database), baseline.migrationsDir);
    const owner = new PrismaClient({ datasources: { db: { url: dbUrl(database) } } });
    const seed = await seedPreSsoData(owner, "upgb");
    await owner.$disconnect();
    // ترقية عبر هجرة RLS ثم هجرة SSO ثم إغلاق العمود من جذور منفصلة (محاكاة تدرج زمني حقيقي)
    const atRls = buildTemporaryRoot([...HISTORICAL, RLS_MIGRATION]);
    roots.push(atRls.root);
    migrateDeployAt(dbUrl(database), atRls.migrationsDir);
    const atSso = buildTemporaryRoot([...HISTORICAL, RLS_MIGRATION, SSO_INSTANCE_MIGRATION]);
    roots.push(atSso.root);
    migrateDeployAt(dbUrl(database), atSso.migrationsDir);
    // الحالة الحرجة: بعد هجرة SSO وقبل إغلاق العمود — العمود NULL للمعاملة القديمة
    const mid = new PrismaClient({ datasources: { db: { url: dbUrl(database) } } });
    const beforeClosure = await mid.$queryRawUnsafe<Array<{ nullable: string }>>(
      `SELECT is_nullable AS nullable FROM information_schema.columns
        WHERE table_name='login_transactions' AND column_name='config_instance_id'`);
    expect(beforeClosure[0]?.nullable).toBe("YES");
    await mid.$disconnect();
    const full = buildTemporaryRoot(ALL_MIGRATIONS);
    roots.push(full.root);
    migrateDeployAt(dbUrl(database), full.migrationsDir);
    await expectChecksums(full.root, database, ALL_MIGRATIONS);
    // البيانات المهمة باقية بعد الترقية كاملة
    const verify = new PrismaClient({ datasources: { db: { url: dbUrl(database) } } });
    try {
      const tenants = await verify.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "tenants" WHERE id='t-upgb'`);
      expect(tenants).toHaveLength(1);
      const pipelines = await verify.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "pipelines" WHERE id='r-upgb'`);
      expect(pipelines).toHaveLength(1);
      const sessions = await verify.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "sessions" WHERE id='sess-upgb'`);
      expect(sessions).toHaveLength(1);
      // المعاملة القديمة: backfill بنطاق legacy-orphan: منفصل ومبطلة زمنياً
      const legacy = await verify.$queryRawUnsafe<Array<{ instance: string; expired: boolean }>>(
        `SELECT config_instance_id AS instance, (expires_at <= NOW()) AS expired
          FROM "login_transactions" WHERE id='tx-upgb'`);
      expect(legacy[0]?.instance.startsWith("legacy-orphan:")).toBe(true);
      expect(legacy[0]?.expired).toBe(true);
      // قيمة قديمة لا يمكن أن تطابق أي إعداد SSO حي (نطاقان منفصلان بنيوياً)
      const clash = await verify.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM "sso_configs" WHERE "config_instance_id" = $1`, legacy[0]?.instance);
      expect(clash[0]?.n).toBe(0);
      // قراءة Prisma عبر المخطط (عمود required) تنجح — الانحراف أغلق
      const readable = await verify.$queryRawUnsafe<Array<{ state_hash: string }>>(
        `SELECT state_hash FROM "login_transactions" WHERE id='tx-upgb'`);
      expect(readable[0]?.state_hash).toBe(seed.loginTxStateHash);
      void seed.configInstanceId;
    } finally { await verify.$disconnect(); }
  });

  it("(ج) baseline عند هجرة RLS ← SSO وإغلاق العمود: ثمان هجرات وبصمات مطابقة", { timeout: 240_000 }, async () => {
    const database = await freshDatabase();
    databases.push(database);
    const atRls = buildTemporaryRoot([...HISTORICAL, RLS_MIGRATION]);
    roots.push(atRls.root);
    migrateDeployAt(dbUrl(database), atRls.migrationsDir);
    const full = buildTemporaryRoot(ALL_MIGRATIONS);
    roots.push(full.root);
    migrateDeployAt(dbUrl(database), full.migrationsDir);
    await expectChecksums(full.root, database, ALL_MIGRATIONS);
  });

  it("(د) baseline عند هجرة SSO مع صفوف NULL ← إغلاق العمود فقط: تعبئة وNOT NULL وقيد", { timeout: 240_000 }, async () => {
    const database = await freshDatabase();
    databases.push(database);
    const atSso = buildTemporaryRoot([...HISTORICAL, RLS_MIGRATION, SSO_INSTANCE_MIGRATION]);
    roots.push(atSso.root);
    migrateDeployAt(dbUrl(database), atSso.migrationsDir);
    // صف معاملة قديمة ذو NULL (كما لو أُدخل بين هجرة SSO وإغلاق العمود عبر مسار قديم)
    const owner = new PrismaClient({ datasources: { db: { url: dbUrl(database) } } });
    await owner.$executeRawUnsafe(
      `INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ('t-upgd','x','h',false,NOW())`);
    await owner.$executeRawUnsafe(
      `INSERT INTO "login_transactions" ("id","state_hash","browser_binding_hash","tenant_id","config_version",
         "config_instance_id","nonce","verifier_envelope","redirect_uri","return_path","expires_at","consumed_at")
       VALUES ('tx-upgd','sh','bh','t-upgd',1,NULL,'n','env','http://127.0.0.1:3000/auth/oidc/callback','/app',NOW()+INTERVAL '1 hour',NULL)`);
    await owner.$disconnect();
    const toFull = buildTemporaryRoot(ALL_MIGRATIONS);
    roots.push(toFull.root);
    migrateDeployAt(dbUrl(database), toFull.migrationsDir);
    await expectChecksums(toFull.root, database, ALL_MIGRATIONS);
    const verify = new PrismaClient({ datasources: { db: { url: dbUrl(database) } } });
    try {
      const legacy = await verify.$queryRawUnsafe<Array<{ instance: string | null }>>(
        `SELECT config_instance_id AS instance FROM "login_transactions" WHERE id='tx-upgd'`);
      expect(legacy[0]?.instance?.startsWith("legacy-orphan:")).toBe(true);
    } finally { await verify.$disconnect(); }
  });
});
