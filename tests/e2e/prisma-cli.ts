/**
 * مشغّل Prisma CLI بلا shell (لا DEP0190 ولا shell:true).
 * كيف: spawnSync(process.execPath, [prismaEntry, ...args]) — لا .CMD على
 * Windows ولا shell وسيط؛ stdout/stderr يلتقطان كاملين والخروج من العملية.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, cpSync, writeFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** جذر حزمة infra مبني من موقع هذا الملف — بلا اعتماد على cwd */
export const INFRA_ROOT = join(import.meta.dirname, "..", "..", "packages", "infra");
export const REAL_MIGRATIONS_DIR = join(INFRA_ROOT, "prisma", "migrations");
export const REAL_SCHEMA_PATH = join(INFRA_ROOT, "prisma", "schema.prisma");
export const PRISMA_ENTRY = join(INFRA_ROOT, "node_modules", "prisma", "build", "index.js");

/** خطأ صريح عند أي إشارة خاسرة من Prisma — يمنع النجاح الزائف بالصمت */
export class MigrationCliError extends Error {}

/** إشارات خاسرة تُبحث في مخرجات deploy حرفياً — أي إشارة تفشل الشوط */
const FAILURE_MARKERS = ["modified migration", "checksum mismatch", "failed migration", "drift detected", "migration failed"] as const;

export interface CliResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** تشغيل CLI خام — يُستخدم مباشرة في negative control حيث الفشل مقصود */
export function runPrismaCli(args: readonly string[], databaseUrl: string, cwd: string): CliResult {
  const result = spawnSync(process.execPath, [PRISMA_ENTRY, ...args], {
    cwd, shell: false, windowsHide: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** deploy الهجرات على قاعدة — يفشل صريحاً عند أي إشارة خاسرة أو خروج غير صفري */
export function migrateDeployAt(databaseUrl: string, migrationsDir: string): CliResult {
  const schemaPath = join(migrationsDir, "..", "schema.prisma");
  const result = runPrismaCli(["migrate", "deploy", "--schema", schemaPath], databaseUrl, migrationsDir);
  if (result.status !== 0) {
    throw new MigrationCliError(`deploy فشل exit=${result.status}\nstdout=${result.stdout}\nstderr=${result.stderr}`);
  }
  const combined = `${result.stdout}\n${result.stderr}`.toLowerCase();
  const markers = FAILURE_MARKERS.filter((marker) => combined.includes(marker));
  if (markers.length > 0) throw new MigrationCliError(`Prisma وضع إشارة خاسرة: ${markers.join(" | ")}`);
  return result;
}

/**
 * جذر مؤقت خارج المستودع ببنية schema + lock + migrations محددة.
 * يعيد بصمة sha256 لكل هجرة منسوخة (قراءة قرص لا إعادة صياغة).
 */
export function buildTemporaryRoot(migrations: readonly string[]): { root: string; migrationsDir: string; sha: Map<string, string> } {
  const root = join(tmpdir(), `ab-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const migrationsDir = join(root, "migrations");
  mkdirSync(migrationsDir, { recursive: true });
  cpSync(join(REAL_MIGRATIONS_DIR, "migration_lock.toml"), join(migrationsDir, "migration_lock.toml"));
  writeFileSync(join(root, "schema.prisma"), readFileSync(REAL_SCHEMA_PATH, "utf8"), "utf8");
  const sha = new Map<string, string>();
  for (const name of migrations) {
    const dest = join(migrationsDir, name);
    mkdirSync(dest, { recursive: true });
    cpSync(join(REAL_MIGRATIONS_DIR, name, "migration.sql"), join(dest, "migration.sql"));
    sha.set(name, createHash("sha256").update(readFileSync(join(dest, "migration.sql"), "utf8"), "utf8").digest("hex"));
  }
  return { root, migrationsDir, sha };
}

/** بصمة sha256 حرفية من القرص */
export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path, "utf8"), "utf8").digest("hex");
}

/** حارس قبل أي حذف: المسار يجب أن يقع داخل tmpdir الحقيقي */
export function assertInsideTmpdir(path: string): void {
  const normalized = path.replaceAll("\\", "/").toLowerCase();
  const tmp = tmpdir().replaceAll("\\", "/").toLowerCase();
  if (!normalized.startsWith(tmp)) throw new Error(`رفض الحذف: ${path} خارج os.tmpdir()`);
}

/** فحص وجود أدوات إلزامية — غياب prisma entry يعني بيئة غير مهيأة */
export function assertToolingPresent(): void {
  if (!existsSync(PRISMA_ENTRY)) throw new Error(`Prisma entry مفقود: ${PRISMA_ENTRY}`);
  if (!existsSync(REAL_SCHEMA_PATH)) throw new Error(`schema.prisma مفقود: ${REAL_SCHEMA_PATH}`);
}
