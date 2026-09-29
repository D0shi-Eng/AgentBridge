/**
 * تحكم سلبي مزدوج الإشارة لبصمات الهجرات.
 * حقيقة مكتشفة: prisma migrate deploy لا يعيد فحص checksums للمطبَّق
 * (هذا سلوك migrate dev) — لذا الإثبات على إشارتين مستقلتين:
 *  (1) عبث مكسور في هجرة تاريخية داخل النسخة المؤقتة ⇒ فشل الترقية بسببه الصحيح.
 *  (2) عبث صامت (تعليق) يمر عبر deploy ⇒ طبقة التحقق (checksums من
 *      _prisma_migrations مقابل بصمات الملفات الأصلية) تكشف mismatch.
 * والمصداقية: الملف الأصلي سليم (بصمة قبل/بعد) والجذور تُمسح داخل tmpdir حصراً.
 */
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_MIGRATIONS, SSO_INSTANCE_MIGRATION, buildTemporaryRoot, dbUrl,
  dropEphemeralDatabase, fileSha256, freshDatabase, listApplied,
  liveUp, migrateDeployAt, safeRemoveRoot,
} from "./upgrade-harness.js";
import { REAL_MIGRATIONS_DIR } from "./prisma-cli.js";

const databases: string[] = [];
const roots: string[] = [];

afterAll(async () => {
  for (const database of databases) await dropEphemeralDatabase(database);
  for (const root of roots) safeRemoveRoot(root);
});

/** يعبث موضعاً واحداً في نسخة هجرة SSO داخل الجذر المؤقت فقط */
function tamperCopy(migrationsDir: string, find: string, replace: string): void {
  const copyPath = join(migrationsDir, SSO_INSTANCE_MIGRATION, "migration.sql");
  const original = readFileSync(copyPath, "utf8");
  const tampered = original.replace(find, replace);
  expect(tampered).not.toBe(original);
  writeFileSync(copyPath, tampered, "utf8");
}

const originalPath = join(REAL_MIGRATIONS_DIR, SSO_INSTANCE_MIGRATION, "migration.sql");

describe.skipIf(!liveUp)("التحكم السلبي لبصمات الهجرات", () => {
  it("(1) عبث مكسور بايت واحد في نسخة تاريخية ⇒ فشل الترقية بالسبب الصحيح", { timeout: 240_000 }, async () => {
    const hashBefore = fileSha256(originalPath);
    const database = await freshDatabase();
    databases.push(database);
    const { root, migrationsDir } = buildTemporaryRoot(ALL_MIGRATIONS);
    roots.push(root);
    // كسر السطر الأول: من تعليق إلى كود غير صالح «x-» فترفضه PostgreSQL
    tamperCopy(migrationsDir, "-- ترقية الهوية:", "x- ترقية الهوية:");
    let failureMessage = "";
    try {
      migrateDeployAt(dbUrl(database), migrationsDir);
      throw new Error("نجاح غير مقصود — التحكم السلبي يجب أن يفشل");
    } catch (error) {
      failureMessage = (error as Error).message;
    }
    expect(failureMessage).toContain("exit=1");
    const combined = failureMessage.toLowerCase();
    const validCause = combined.includes("syntax") || combined.includes("migration failed") || combined.includes("p3018");
    expect(validCause).toBe(true);
    expect(fileSha256(originalPath)).toBe(hashBefore);
  });

  it("(2) عبث صامت في تعليق يمر عبر deploy ⇒ طبقة التحقق تكشف checksum mismatch", { timeout: 240_000 }, async () => {
    const hashBefore = fileSha256(originalPath);
    const database = await freshDatabase();
    databases.push(database);
    const { root, migrationsDir } = buildTemporaryRoot(ALL_MIGRATIONS);
    roots.push(root);
    // عبث في تعليق لا يكسر SQL — deploy سينجح ويسجل checksum للنسخة المعبثة
    tamperCopy(migrationsDir, "-- ترقية الهوية:", "-- ترقية الهوية (عبث):");
    migrateDeployAt(dbUrl(database), migrationsDir);
    // طبقة التحقق: مقارنة checksums المسجلة في _prisma_migrations بالملفات الأصلية
    const applied = await listApplied(database);
    const ssoEntry = applied.find((entry) => entry.name === SSO_INSTANCE_MIGRATION);
    expect(ssoEntry).toBeDefined();
    expect(ssoEntry?.checksum).not.toBe(fileSha256(originalPath));
    // والبصمة الحقيقية للملف الأصلي لم تتغير إطلاقاً
    expect(fileSha256(originalPath)).toBe(hashBefore);
    // والمطابقة المرجعية: هجرة سليمة تساوي بصمتها الأصلية
    const init = applied.find((entry) => entry.name === "20260825135637_init");
    expect(init?.checksum).toBe(fileSha256(join(REAL_MIGRATIONS_DIR, "20260825135637_init", "migration.sql")));
  });
});
