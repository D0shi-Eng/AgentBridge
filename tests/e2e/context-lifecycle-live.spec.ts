/**
 * دورة حياة السياق: GUC محلي للمعاملة،
 * لا تسرب بعدها، والتزامن عبر pool لا يسرق السياق بين المستأجرين.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { withTenantPrisma, createPrismaFlywheelStore, createPgVectorStore } from "@agentbridge/infra";
import { createEphemeralDatabase, dropEphemeralDatabase, provisionRestrictedRole, restrictedPrisma, seedViaOwner } from "./rls-live-harness.js";
import { liveUp } from "./upgrade-harness.js";
import { REAL_MIGRATIONS_DIR, migrateDeployAt } from "./prisma-cli.js";

let prisma: PrismaClient | null = null;
let database = "";
let adminUrl = "";

beforeAll(async () => {
  if (!liveUp) return;
  const created = await createEphemeralDatabase();
  database = created.database;
  adminUrl = created.adminUrl;
  migrateDeployAt(adminUrl, REAL_MIGRATIONS_DIR);
  prisma = restrictedPrisma(await provisionRestrictedRole(adminUrl, database));
  await seedViaOwner(adminUrl, [{ id: "t-guc-a", name: "A" }, { id: "t-guc-b", name: "B" }]);
}, 240_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (database !== "") await dropEphemeralDatabase(database);
});

function client(): PrismaClient {
  if (prisma === null) throw new Error("القاعدة الحية غير مهيأة");
  return prisma;
}

async function tenantGuc(): Promise<string> {
  const rows = await client().$queryRawUnsafe<Array<{ value: string }>>(
    `SELECT current_setting('app.tenant_id', true) AS value`);
  return rows[0]?.value ?? "";
}

describe.skipIf(!liveUp)("دورة حياة السياق والتزامن", () => {
  it("GUC يضبط داخل المعاملة نفسها ويقرأ فيها، ويصبح فارغاً بعدها", async () => {
    await withTenantPrisma(client(), "t-guc-a", async (tx) => {
      const inside = await tx.$queryRawUnsafe<Array<{ value: string }>>(
        `SELECT current_setting('app.tenant_id', true) AS value`);
      expect(inside[0]?.value).toBe("t-guc-a");
      // العمل على عميل المعاملة نفسه يرى نطاق المستأجر حصراً
      const tenants = await tx.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "tenants" WHERE id IN ('t-guc-a','t-guc-b')`);
      expect(tenants.map((entry) => entry.id)).toEqual(["t-guc-a"]);
    });
    // بعد المعاملة: set_config(…, true) local ينتهي — لا تسرب للسياق
    await expect(tenantGuc()).resolves.toBe("");
  });

  it("التزامن عبر pool: عمليات A وB متشابكة ولا يسرق أحدهما سياق الآخر", async () => {
    const store = createPrismaFlywheelStore(client(), createPgVectorStore(client()));
    const ctx = (tenantId: string) => ({
      tenantId,
      principal: {
        actorType: "service" as const, authMethod: "api_key" as const, subjectId: `svc:${tenantId}`,
        credentialId: `c-${tenantId}`, tenantId,
        permissions: ["flywheel:write" as const], authorizationVersion: 1,
      },
    });
    const lesson = (tenantId: string, tag: string) => ({
      specPattern: `race-${tag}`, designDecision: `d-${tag}`, outcome: "success" as const,
      score: 50, tenantId, createdAt: new Date().toISOString(),
    });
    // 12 عملية متشابكة (6 لكل مستأجر) فوق pool واحد
    const operations: Array<Promise<void>> = [];
    for (let index = 0; index < 6; index += 1) {
      operations.push(store.saveLesson(ctx("t-guc-a"), lesson("t-guc-a", `a${index}`)));
      operations.push(store.saveLesson(ctx("t-guc-b"), lesson("t-guc-b", `b${index}`)));
    }
    await Promise.all(operations);
    const lessonsA = await store.listRecent(ctx("t-guc-a"), 50);
    const lessonsB = await store.listRecent(ctx("t-guc-b"), 50);
    expect(lessonsA.filter((entry) => entry.specPattern.startsWith("race-a"))).toHaveLength(6);
    expect(lessonsA.some((entry) => entry.specPattern.startsWith("race-b"))).toBe(false);
    expect(lessonsB.filter((entry) => entry.specPattern.startsWith("race-b"))).toHaveLength(6);
    expect(lessonsB.some((entry) => entry.specPattern.startsWith("race-a"))).toBe(false);
    // ولا تسرب GUC بعد التشابك
    await expect(tenantGuc()).resolves.toBe("");
  });
});
