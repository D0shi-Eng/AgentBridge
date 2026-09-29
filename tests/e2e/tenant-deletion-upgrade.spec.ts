/**
 * اختبار هجرة الترقية الحية (FSC): قاعدة بحالة final-closure
 * (11 هجرة) مع بيانات موجودة، ثم تطبيق هجرة التصحيح الأمني (12) فوقها —
 * لا تعديل هجرة تاريخية، ولا فقدان بيانات، والتحقق من بقاء FORCE RLS
 * وسياسة الحذف الجديدة على الهويات بعد الترقية.
 *
 * شرط العمل: قاعدة حية (docker-compose.dev 5433). غيابها تخطٍّ موثق.
 */

import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { LIVE_DATABASE_URL } from "../../packages/infra/src/live-config.js";
import { onboardTenantLive } from "../../packages/infra/src/index.js";

const ADMIN_URL = process.env.AB_LIVE_DATABASE_URL ?? LIVE_DATABASE_URL;
const INFRA_ROOT = fileURLToPath(new URL("../../packages/infra", import.meta.url));
/** الهجرات الـ11 لحالة final-closure — كل ما سبق هجرة FSC */
const PRE_DELETION_MIGRATIONS = [
  "20260825135637_init", "20260831000000_add_llm_spend", "20260901000000_add_memory_embeddings",
  "20260902000000_add_flywheel_lessons", "20260905030000_trusted_identity_isolation",
  "20260907160000_rls_and_cas", "20260907200000_sso_instance_and_identity_policy",
  "20260912000000_login_tx_instance_not_null", "20260918000000_run_state_archives",
  "20260920030000_certificate_revocations", "20260920200000_tenant_lifecycle",
] as const;
const DELETION_MIGRATION = "20260921030000_tenant_deletion_operations";

function dbUrl(database: string): string {
  return `${ADMIN_URL.replace(/\/[^/?]+(\?.*)?$/u, "")}/${database}`;
}

function deployAt(database: string, schemaPath: string): void {
  execSync(`npx prisma migrate deploy --schema ${JSON.stringify(schemaPath)}`, {
    stdio: "pipe", env: { ...process.env, DATABASE_URL: dbUrl(database) }, cwd: INFRA_ROOT,
  });
}

async function probe(url: string): Promise<boolean> {
  const probe = new PrismaClient({ datasources: { db: { url: `${url}${url.includes("?") ? "&" : "?"}connect_timeout=2` } } });
  try { await probe.$queryRaw`SELECT 1`; return true; } catch { return false; } finally { await probe.$disconnect(); }
}

const available = await probe(ADMIN_URL);
if (!available) {
  console.info("[تخطٍّ موثق] اختبار هجرة الترقية الحية: لا قاعدة PostgreSQL على العنوان المضبوط");
}

describe.skipIf(!available)("FSC — هجرة الترقية من حالة final-closure ببيانات", () => {
  const database = `ab_fsc_upg_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const url = dbUrl(database);
  let admin: PrismaClient;
  let target: PrismaClient;

  beforeAll(async () => {
    admin = new PrismaClient({ datasources: { db: { url: ADMIN_URL } } });
    await admin.$executeRawUnsafe(`CREATE DATABASE ${JSON.stringify(database)}`);
    target = new PrismaClient({ datasources: { db: { url } } });
  });

  afterAll(async () => {
    await target?.$disconnect();
    await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${JSON.stringify(database)} WITH (FORCE)`);
    await admin?.$disconnect();
  });

  it("upgrade: حالة final-closure (11 هجرة) ببيانات ثم هجرة FSC فوقها بلا فقدان بيانات", async () => {
    // (1) بناء حالة final-closure: استنساخ شجرة الهجرات بلا هجرة FSC إلى
    // جذر مؤقت داخل المستودع (درس العمل الحي: workRoot داخل المستودع)
    const { mkdtempSync, cpSync, rmSync, existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    const staging = mkdtempSync(join(INFRA_ROOT, ".fsc-upgrade-"));
    try {
      cpSync(join(INFRA_ROOT, "prisma"), join(staging, "prisma"), { recursive: true });
      rmSync(join(staging, "prisma", "migrations", DELETION_MIGRATION), { recursive: true, force: true });
      expect(existsSync(join(staging, "prisma", "migrations", DELETION_MIGRATION))).toBe(false);
      deployAt(database, join(staging, "prisma", "schema.prisma"));
      const applied = await target.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT migration_name AS name FROM _prisma_migrations ORDER BY started_at`);
      expect(applied.map((r) => r.name)).toEqual([...PRE_DELETION_MIGRATIONS]);

      // (2) بيانات موجودة في حالة final-closure: مستأجر ومالك عبر onboarding الحي
      const seeded = await onboardTenantLive(target, target, {
        tenantId: "upg-alpha", tenantName: "ترقية ألفا", ownerIssuer: "https://idp.upg.test", ownerSubject: "upg-1",
        credentialPermissions: ["resource:read"] as const, expiresInDays: 30,
        nowIso: new Date().toISOString(), initial: true,
      });
      expect(seeded.credentialId).toBe("bootstrap-upg-alpha");

      // (3) الترقية: هجرة FSC فوق الحالة المعبأة — forward-only
      deployAt(database, join(INFRA_ROOT, "prisma", "schema.prisma"));
      const appliedAfter = await target.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT migration_name AS name FROM _prisma_migrations ORDER BY started_at`);
      expect(appliedAfter.map((r) => r.name)).toEqual([...PRE_DELETION_MIGRATIONS, DELETION_MIGRATION]);

      // (4) لا فقدان بيانات: المستأجر والمالك بأماكنهم بعد الترقية
      const tenants = await target.$queryRawUnsafe<Array<{ id: string; is_admin: boolean }>>(
        `SELECT id, is_admin FROM tenants WHERE id = 'upg-alpha'`);
      expect(tenants).toHaveLength(1);
      expect(tenants[0]?.is_admin).toBe(true);
      const identities = await target.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM external_identities WHERE subject = 'upg-1'`);
      expect(identities[0]?.n).toBe(1);
      // (5) سجل عمليات الحذف موجود وفارغ وFORCE RLS نافذ عليه
      const ops = await target.$queryRawUnsafe<Array<{ n: number }>>(
        `SELECT count(*)::int AS n FROM tenant_deletion_operations`);
      expect(ops[0]?.n).toBe(0);
      const rls = await target.$queryRawUnsafe<Array<{ relforce: boolean }>>(
        `SELECT relforcerowsecurity AS relforce FROM pg_class WHERE relname = 'tenant_deletion_operations'`);
      expect(rls[0]?.relforce).toBe(true);
      // (6) سياسة DELETE الجديدة على الهويات نافذة
      const policies = await target.$queryRawUnsafe<Array<{ policyname: string }>>(
        `SELECT policyname FROM pg_policies WHERE tablename = 'external_identities' AND cmd = 'DELETE'`);
      expect(policies.map((p) => p.policyname)).toContain("identity_admin_delete");
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  });
});
