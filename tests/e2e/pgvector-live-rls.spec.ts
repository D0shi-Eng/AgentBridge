/**
 * pgvector حي بالدور المقيد ومع TenantContext داخل المعاملة.
 * القاعدة المؤقتة + الدور المقيد + كل عملية عبر withTenantPrisma — لا skip
 * في الشوط الحي، والفروع مُقاسة (pgvector-store خارج قائمة الاستثناء حين
 * البنية حية في vitest.config.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgVectorStore } from "../../packages/infra/src/pgvector-store.js";
import type { TenantContext } from "@agentbridge/shared";
import {
  liveAvailable, createEphemeralDatabase, dropEphemeralDatabase,
  deployMigrations, provisionRestrictedRole, restrictedPrisma,
} from "./rls-live-harness.js";

function tenantContext(tenantId: string): TenantContext {
  return {
    tenantId,
    principal: {
      actorType: "service", authMethod: "api_key", subjectId: "pgvector-live-test",
      tenantId, credentialId: "pgvector-live-test", authorizationVersion: 1,
      permissions: ["resource:read", "flywheel:read", "flywheel:write"],
    },
  };
}

describe.skipIf(!liveAvailable)("pgvector الحي بالدور المقيد", () => {
  let database: string;
  let adminUrl: string;
  let store: ReturnType<typeof createPgVectorStore>;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    ({ database, adminUrl } = await createEphemeralDatabase());
    deployMigrations(adminUrl);
    const restrictedUrl = await provisionRestrictedRole(adminUrl, database);
    const prisma = restrictedPrisma(restrictedUrl);
    store = createPgVectorStore(prisma);
    cleanup = async () => { await prisma.$disconnect(); };
  });

  afterAll(async () => {
    await cleanup?.();
    if (database !== undefined) await dropEphemeralDatabase(database);
  });

  it("upsert + search + remove داخل مستأجر واحد عبر معاملات RLS", async () => {
    const tenant = "t-vec";
    const context = tenantContext(tenant);
    const vecA = Array.from({ length: 1536 }, (_, i) => (i % 2 === 0 ? 0.5 : -0.5));
    const vecB = Array.from({ length: 1536 }, (_, i) => (i % 2 === 0 ? -0.5 : 0.5));
    await store.upsert(context, { id: "docA", tenantId: tenant, namespace: "spec", vector: vecA, metadata: { tag: "a" } });
    await store.upsert(context, { id: "docB", tenantId: tenant, namespace: "spec", vector: vecB, metadata: { tag: "b" } });
    const hits = await store.search(context, "spec", vecA, 2);
    expect(hits.length).toBe(2);
    expect(hits[0]?.id).toBe("docA"); // الأقرب لنفسه
    await store.remove(context, "spec", "docA");
    const after = await store.search(context, "spec", vecA, 2);
    expect(after.find((h) => h.id === "docA")).toBeUndefined();
  });

  it("عزل المستأجرين في المتجهات: B لا يرى صفوف A داخل المعاملة", async () => {
    const contextA = tenantContext("t-vec-a");
    const contextB = tenantContext("t-vec-b");
    const vec = Array.from({ length: 1536 }, (_, i) => (i % 2 === 0 ? 1 : 0));
    await store.upsert(contextA, { id: "docA1", tenantId: "t-vec-a", namespace: "spec", vector: vec, metadata: {} });
    // بحث B لا يعيد شيئاً من A — السياسة تقيد الصفوف بالسياق
    const hits = await store.search(contextB, "spec", vec, 10);
    expect(hits.find((h) => h.id === "docA1")).toBeUndefined();
  });
});
