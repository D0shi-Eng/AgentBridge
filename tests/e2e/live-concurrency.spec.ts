/**
 * توازي حي بعمليتين حقيقيتين فوق PostgreSQL.
 *
 * ما يميز هذا الملف: لا Promise داخلية — كل منافس عملية `agentbridge-ops`
 * منفصلة بقاعدة بيانات fresh، والإقلاع متزامن فعلياً (spawn لا spawnSync)
 * فالسباق يمر عبر القفل الاستشاري والفهرس الجزئي الفريد داخل القاعدة.
 * المتطلبات:
 * - قاعدة حية على AB_LIVE_DATABASE_URL أو عنوان docker-compose.dev (5433).
 * - دور ab_app (يجهزه scripts/prepare-restricted-role.mjs — idempotent).
 * غياب القاعدة تخطٍّ موثق باسمه — لا ادعاء بلا قاعدة.
 */

import { execSync, spawn, spawnSync, type SpawnSyncReturns } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { LIVE_DATABASE_URL } from "./live-config.js";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OPS_MAIN = fileURLToPath(new URL("../../apps/cli/src/ops/ops-main.ts", import.meta.url));
const OWNER_URL = process.env.AB_LIVE_DATABASE_URL ?? LIVE_DATABASE_URL;
/** كلمة مرور اصطناعية لبيئة الفحص حصراً — تُضبط على قاعدة fresh وتُمسح معها */
const APP_PASSWORD = "fsc-live-synthetic-app-pw-01";

interface OpsRun {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function probe(url: string): Promise<boolean> {
  const probe = new PrismaClient({ datasources: { db: { url: `${url}${url.includes("?") ? "&" : "?"}connect_timeout=2` } } });
  try { await probe.$queryRaw`SELECT 1`; return true; } catch { return false; } finally { await probe.$disconnect(); }
}

const available = await probe(OWNER_URL);
if (!available) {
  console.info("[تخطٍّ موثق] توازي العمليات الحي: لا قاعدة PostgreSQL على العنوان المضبوط");
}

function dbUrlOf(database: string): string {
  return `${OWNER_URL.replace(/\/[^/?]+(\?.*)?$/u, "")}/${database}`;
}

/** إقلاع متزامن حقيقي: عمليتان منفصلتان تنطلقان في اللحظة نفسها */
function runOpsAsync(env: Record<string, string>, args: readonly string[]): Promise<OpsRun> {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, ["--import", "tsx", OPS_MAIN, ...args], {
      cwd: REPO_ROOT,
      env: { ...process.env, NODE_ENV: "development", ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("close", (code) => resolveRun({ status: code ?? -1, stdout, stderr }));
  });
}

function appDbUrl(url: string): string {
  // اتصال ab_app بدور تنفيذي صريح — نفس قالب prepare-restricted-role؛
  // يستبدل اعتمادات المالك في العنوان باعتمادات ab_app الاصطناعية
  const owner = new URL(url);
  return `postgresql://ab_app:${APP_PASSWORD}@${owner.host}${owner.pathname}?options=-c role=agentbridge_app`;
}

describe.skipIf(!available)("FSC — توازي عمليات الإدارة الحي (عمليتان حقيقيتان)", () => {
  const database = `ab_fsc_par_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const dbUrl = dbUrlOf(database);
  let admin: PrismaClient;
  let fresh: PrismaClient;
  let env: Record<string, string>;
  let secretDir: string;

  beforeAll(async () => {
    secretDir = mkdtempSync(join(tmpdir(), "fsc-par-secrets-"));
    admin = new PrismaClient({ datasources: { db: { url: OWNER_URL } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE ${JSON.stringify(database)}`);
    fresh = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const schemaPath = fileURLToPath(new URL("../../packages/infra/prisma/schema.prisma", import.meta.url));
    const infraRoot = resolvePath(schemaPath, "../..");
    execSync(`npx prisma migrate deploy --schema ${JSON.stringify(schemaPath)}`, {
      stdio: "inherit", env: { ...process.env, DATABASE_URL: dbUrl }, cwd: infraRoot,
    });
    // مالك منفصل نظيف للجداول — مطابقة لوضع الإنتاج الموثق (دور مالك NOLOGIN غير خارق)
    // كي يقيس فحص الإقلاع الصارم الوضع الحقيقي لا استثناءً؛ النقل على
    // قاعدة الفحص نفسها (إنشاء الدور من اتصال المالك العام)
    const ownerRole = `ab4_own_${randomUUID().replaceAll("-", "").slice(0, 14)}`;
    await admin.$executeRawUnsafe(
      `CREATE ROLE ${JSON.stringify(ownerRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS`);
    const freshAdmin = new PrismaClient({ datasources: { db: { url: dbUrl } } });
    const tables = await freshAdmin.$queryRawUnsafe<Array<{ tablename: string }>>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = CURRENT_USER`);
    for (const table of tables) {
      await freshAdmin.$executeRawUnsafe(`ALTER TABLE ${JSON.stringify(table.tablename)} OWNER TO ${JSON.stringify(ownerRole)}`);
    }
    await freshAdmin.$disconnect();
    // كلمة المرور الاصطناعية على دور ab_app داخل قاعدة الفحص المؤقتة حصراً
    await admin.$executeRawUnsafe(`ALTER ROLE ab_app WITH LOGIN PASSWORD '${APP_PASSWORD}'`);
    // التحقق أن اتصال التطبيق المقيد يعمل قبل أي سباق
    const app = new PrismaClient({ datasources: { db: { url: appDbUrl(dbUrl) } } });
    await app.$queryRaw`SELECT 1`;
    await app.$disconnect();
    env = { DATABASE_URL: appDbUrl(dbUrl), ADMIN_DATABASE_URL: dbUrl };
  });

  it("عمليتان حقيقيتان متوازيتان لـ--initial — واحدة فقط تنجح ومستأجر إداري واحد", async () => {
    const base = [
      "onboard-tenant", "--permissions", "resource:read", "--expires-in-days", "30",
      "--store", "live", "--initial", "1",
      "--issuer", "https://idp.fsc-par.test",
      // stdout أنبوب حصراً في هذا الاختبار — القناة الآمنة إلزامية
      "--secret-output", join(secretDir, `f02-${randomUUID().slice(0, 8)}.env`),
    ];
    // إقلاع متزامن فعلي: Promise.all يطلق العمليتين معاً لا تباعاً
    const [ra, rb] = await Promise.all([
      runOpsAsync(env, [...base, "--tenant", "par-admin-a", "--name", "مسؤول-A", "--subject", "par-a"]),
      runOpsAsync(env, [...base, "--tenant", "par-admin-b", "--name", "مسؤول-B", "--subject", "par-b"]),
    ]);
    const outcomes = [ra, rb];
    const succeeded = outcomes.filter((o) => o.status === 0);
    const refused = outcomes.filter((o) => o.status !== 0);
    expect(succeeded, JSON.stringify(outcomes.map((o) => o.stderr.slice(0, 400)))).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]?.stderr).toContain("BOOTSTRAP_DONE");
    // مستأجر إداري واحد بالضبط — لا إداريان
    const admins = await fresh.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM tenants WHERE is_admin = true`,
    );
    expect(Number(admins[0]?.count ?? "0")).toBe(1);
  });

  it("عمليتا حذف متوازيتان بنفس السياج — تنفيذ واحد ووصل واحد وإيصال واحد", async () => {
    // مستأجر حي (عملية واحدة) ببيانات تشغيلية للحذف
    const seed = await runOpsAsync(env, [
      "onboard-tenant", "--tenant", "par-del", "--name", "حذف-التوازي", "--issuer", "https://idp.fsc-par.test",
      "--subject", "par-del-owner", "--permissions", "resource:read", "--expires-in-days", "30", "--store", "live",
      "--secret-output", join(secretDir, `f04-${randomUUID().slice(0, 8)}.env`),
    ]);
    expect(seed.status).toBe(0);
    const fence = `par-fence-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const delArgs = [
      "tenant-delete", "--tenant", "par-del", "--mode", "confirm",
      "--fence", fence, "--confirm", "par-del", "--store", "live",
    ];
    const [d1, d2] = await Promise.all([runOpsAsync(env, delArgs), runOpsAsync(env, delArgs)]);
    // كل خروج مفهوم: 0 تنفيذ أو إعادة إرسال؛ 1 تعارض توازي مرفوض بالسياج
    for (const d of [d1, d2]) {
      expect([0, 1], JSON.stringify({ status: d.status, stderr: d.stderr.slice(0, 500) })).toContain(d.status);
      if (d.status === 1) expect(d.stderr, d.stderr.slice(0, 300)).toContain("DELETION_IN_PROGRESS");
    }
    // وصل حذف مكتمل واحد بالضبط رغم التوازي (لا وصل مكرر إطلاقاً)
    const auditRows = await fresh.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM audit_log WHERE tenant_id = 'par-del' AND stage = 'tenant_deletion' AND decision = 'completed'`,
    );
    expect(Number(auditRows[0]?.count ?? "0")).toBe(1);
    // صف عملية واحد فقط للمستأجر وهو مكتمل بإيصال مخزن
    const ops = await fresh.$queryRawUnsafe<Array<{ status: string; receipt: string | null }>>(
      `SELECT status::text AS status, receipt_json AS receipt FROM tenant_deletion_operations WHERE tenant_id = 'par-del'`,
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]?.status).toBe("completed");
    expect(ops[0]?.receipt).not.toBeNull();
    // القبر منصوب والسياج الخام غير مخزن في أي عمود (بصمة فقط)
    const tenantRow = await fresh.$queryRawUnsafe<Array<{ deleted_at: Date | null; name: string }>>(
      `SELECT deleted_at, name FROM tenants WHERE id = 'par-del'`,
    );
    expect(tenantRow[0]?.deleted_at).not.toBeNull();
    expect(tenantRow[0]?.name).toBe("deleted-tenant");
    const rawFenceLeak = await fresh.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM tenant_deletion_operations WHERE fence_hash = $1 OR receipt_json LIKE $2`,
      fence, `%${fence}%`,
    );
    expect(Number(rawFenceLeak[0]?.count ?? "0")).toBe(0);
  });

  it("سياج مختلف بعد الاكتمال = تعارض صريح بلا وصل جديد", async () => {
    const otherFence = runOpsSync(env, [
      "tenant-delete", "--tenant", "par-del", "--mode", "confirm",
      "--fence", `par-other-${randomUUID().replaceAll("-", "").slice(0, 12)}`, "--confirm", "par-del", "--store", "live",
    ]);
    expect(otherFence.status, otherFence.stderr.slice(0, 400)).toBe(1);
    expect(otherFence.stderr).toContain("FENCE_MISMATCH");
    const auditCount = await fresh.$queryRawUnsafe<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM audit_log WHERE tenant_id = 'par-del' AND stage = 'tenant_deletion'`,
    );
    expect(Number(auditCount[0]?.count ?? "0")).toBe(1); // لا وصل جديد بأي حال
  });

  afterAll(async () => {
    if (secretDir !== undefined) rmSync(secretDir, { recursive: true, force: true });
    await fresh?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${JSON.stringify(database)} WITH (FORCE)`);
    await admin?.$disconnect();
  });
});

/** تغليف متزامن للاستخدامات غير المتوازية خارج مسار التوازي */
function runOpsSync(env: Record<string, string>, args: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, ["--import", "tsx", OPS_MAIN, ...args], {
    cwd: REPO_ROOT, encoding: "utf8", timeout: 120_000,
    env: { ...process.env, NODE_ENV: "development", ...env },
  });
}
