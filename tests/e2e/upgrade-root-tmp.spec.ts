/**
 * اختبار الترقية الحقيقية بجذر مؤقت — سيناريوهات الثلاثة.
 * الجذر في os.tmpdir() — Prisma لا يقرأ مجلد المشروع؛ والتأكد المقارن
 * بالبصمة (checksum) على قاعدة البيانات. فحص مشروط بالقاعدة الحية.
 */
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { liveUp, dropEphemeralDatabase, ADMIN_URL } from "./upgrade-harness.js";
import {
  RLS_MIGRATION, SSO_INSTANCE_MIGRATION, HISTORICAL,
  buildTemporaryRoot, fileSha256, listApplied, dbUrl, migrateDeployAt,
} from "./upgrade-harness.js";

// الموارد الحييان التي تحملها الجلسة كاملة تمسح في afterAll دائماً
let activeRoot: string | null = null;
const ephemeralDb: string[] = [];

afterAll(async () => {
  for (const db of ephemeralDb) await dropEphemeralDatabase(db);
  // rmSync بعد إغلاق Prisma pool — Windows يرقص على handle مفتوح (EPERM).
  // force:true + recursive:true يسمحان بالمحاولة الصامتة إن قيّد الملف
  // (المجلد مؤقت حُذف على خالص في pnpm-clean session اللاحقة — لا إخفاء).
  if (activeRoot !== null) { try { rmSync(activeRoot, { recursive: true, force: true }); } catch { /* EPERM على Windows — لا إصلاح؛ سيلتقط الدفع في رسم */ } }
});

describe.skipIf(!liveUp)("الترقية الحقيقية بالجذر المؤقت (سيناريوهات ثلاثة)", () => {
  let dbName = "";

  beforeAll(async () => {
    const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    dbName = `ab_upg_tmp_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    await admin.$disconnect();
    ephemeralDb.push(dbName);
  });

  it("(أ) قاعدة فارغة ← جميع الهجرات الحالية تنجح بصمات مطابقة.", async () => {
    const all = [...HISTORICAL, RLS_MIGRATION, SSO_INSTANCE_MIGRATION];
    const { root, migrationsDir } = buildTemporaryRoot(all);
    activeRoot = root;
    const before = await listApplied(dbName);
    expect(before).toHaveLength(0);
    migrateDeployAt(dbUrl(dbName), migrationsDir);
    const after = await listApplied(dbName);
    expect(after.map((m) => m.name)).toEqual(all);
    for (const row of after) {
      const actual = fileSha256(join(migrationsDir, row.name, "migration.sql"));
      expect(row.checksum).toBe(actual);
      expect(row.finished).toBe(true);
    }
    // أعمدة هجرة SSO الجديدة مثبتة
    const client = new PrismaClient({ datasources: { db: { url: dbUrl(dbName) } } });
    try {
      const columns = await client.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sso_configs'
            AND column_name IN ('config_instance_id','config_version')`);
      expect(columns[0]?.n).toBe(2);
    } finally { await client.$disconnect(); }
  });

  it("(ب) خمس تاريخية ببيانات ← هجرة RLS ثم هجرة SSO، البيانات باقية وسياسة الهويات الداخلية مثبتة", async () => {
    // إنشاء قاعدة أخرى منفصلة عن (أ)
    const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    dbName = `ab_upg_tmp_b_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    await admin.$disconnect();
    ephemeralDb.push(dbName);
    const histOnly = [...HISTORICAL];
    // خطوة أولى: الترقية من historical only.
    const { root, migrationsDir } = buildTemporaryRoot(histOnly);
    activeRoot = root;
    migrateDeployAt(dbUrl(dbName), migrationsDir);
    const atHist = await listApplied(dbName);
    expect(atHist.map((m) => m.name)).toEqual(histOnly);
    // ثم الترقية عبر هجرة RLS ثم هجرة SSO — البيانات الاصطناعية تُزرع بمالك mailbox إلزامي
    const seeded = new PrismaClient({ datasources: { db: { url: dbUrl(dbName) } } });
    await seeded.$executeRawUnsafe(`INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ('t-upg','ترقية','h',false,NOW())`);
    await seeded.$executeRawUnsafe(`INSERT INTO "projects" ("id","tenant_id","name","created_at") VALUES ('p-upg','t-upg','مشروع ب',NOW())`);
    await seeded.$disconnect();
    // الترقية عبر هجرة RLS ثم هجرة SSO (مجلة التواريخ مشتملة جميعها)
    migrateDeployAt(dbUrl(dbName), join(root, "migrations"));
    // إزالة النسخ المصدرة القديمة فوقه، ثم ترقية إلى الجذر الكامل
    const fullRoot = buildTemporaryRoot([...HISTORICAL, RLS_MIGRATION, SSO_INSTANCE_MIGRATION]);
    activeRoot = fullRoot.root;
    migrateDeployAt(dbUrl(dbName), join(fullRoot.root, "migrations"));
    const after = await listApplied(dbName);
    expect(after).toHaveLength(7);
    // البيانات الاصطناعية باقية بعد الترقية (كلا من t-upg وp-upg)
    const verify = new PrismaClient({ datasources: { db: { url: dbUrl(dbName) } } });
    try {
      const data = await verify.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "tenants" WHERE id='t-upg'`);
      expect(data).toHaveLength(1);
      const projects = await verify.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "projects" WHERE id='p-upg'`);
      expect(projects).toHaveLength(1);
      // سياسة الهويات الداخلية exact — لا wildcard
      const policy = await verify.$queryRawUnsafe<Array<{ using: string }>>(
        `SELECT pg_get_expr(polqual, polrelid)::text AS using FROM pg_policy
          WHERE polrelid='external_identities'::regclass AND polname='identity_internal_lookup'`);
      // باستعمال identity_exact_lookup — لا wildcard LIKE
      expect(JSON.stringify(policy[0])).not.toContain("internal:%");
    } finally { await verify.$disconnect(); }
  });

  it("(ج) قاعدة عند هجرة RLS ← هجرة SSO فقط — الأعمدة والسياسات تصعد بلا كسر", async () => {
    // قاعدة ثالثة على حالة ما بعد هجرة RLS (payload متوافق معها) — ترقية هجرة SSO إضافية.
    const admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    dbName = `ab_upg_tmp_c_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
    await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
    await admin.$disconnect();
    ephemeralDb.push(dbName);
    // مرحلة 1: الجذر التاريخي بكل ما قبل هجرة SSO (خمس تاريخية + هجرة RLS) — جذر بارنة
    const rlsRoot = buildTemporaryRoot([...HISTORICAL, RLS_MIGRATION]);
    activeRoot = rlsRoot.root;
    migrateDeployAt(dbUrl(dbName), rlsRoot.migrationsDir);
    const atRls = await listApplied(dbName);
    expect(atRls.map((m) => m.name)).toEqual([...HISTORICAL, RLS_MIGRATION]);
    // صفر أعمدة هجرة SSO قبل الترقية (قبل أوانها
    const pre = new PrismaClient({ datasources: { db: { url: dbUrl(dbName) } } });
    try {
      const col = await pre.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema='public' AND table_name='sso_configs' AND column_name='config_instance_id'`);
      expect(col[0]?.n).toBe(0);
    } finally { await pre.$disconnect(); }
    // الترقية بهجرة SSO حصراً — الجذر يحملها إضافية.
    const toSso = buildTemporaryRoot([...HISTORICAL, RLS_MIGRATION, SSO_INSTANCE_MIGRATION]);
    activeRoot = toSso.root;
    migrateDeployAt(dbUrl(dbName), toSso.migrationsDir);
    // إثبات صعود هجرة SSO فقط فوق حالة ما بعد هجرة RLS.
    const after = await listApplied(dbName);
    expect(after.map((m) => m.name)).toEqual([...HISTORICAL, RLS_MIGRATION, SSO_INSTANCE_MIGRATION]);
    expect(after).toHaveLength(7);
  });
});
