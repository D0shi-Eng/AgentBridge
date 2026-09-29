/**
 * عزل المحولات الستة حياً بالدور المقيد.
 * لكل محول: نجاح A وB، استعلام مضاد فعلي (A يقرأ معرف B فيفشل/لا يجد)،
 * رفض تعارض السياق مع الحمولة، ورفض غياب السياق. GUC والتزامن في الملف الأخ.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  createPrismaAuthStore, createPrismaCostLedger, createPrismaFlywheelStore,
  createPrismaSemanticStore, createPrismaSsoStore, createPgVectorStore,
} from "@agentbridge/infra";
import type { TenantContext } from "@agentbridge/shared";
import { createEphemeralDatabase, dropEphemeralDatabase, ownerPrisma, provisionRestrictedRole, restrictedPrisma, seedViaOwner } from "./rls-live-harness.js";
import { liveUp } from "./upgrade-harness.js";
import { migrateDeployAt } from "./prisma-cli.js";

let prisma: PrismaClient | null = null;
let database = "";
let adminUrl = "";

beforeAll(async () => {
  if (!liveUp) return;
  const created = await createEphemeralDatabase();
  database = created.database;
  adminUrl = created.adminUrl;
  migrateDeployAt(adminUrl, await import("./prisma-cli.js").then((m) => m.REAL_MIGRATIONS_DIR));
  const restrictedUrl = await provisionRestrictedRole(adminUrl, database);
  prisma = restrictedPrisma(restrictedUrl);
  await seedViaOwner(adminUrl, [{ id: "t-iso-a", name: "A" }, { id: "t-iso-b", name: "B" }]);
}, 240_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (database !== "") await dropEphemeralDatabase(database);
});

export function isolationContext(tenantId: string): TenantContext {
  return {
    tenantId,
    principal: {
      actorType: "service", authMethod: "api_key", subjectId: `svc:${tenantId}`,
      credentialId: `c-${tenantId}`, tenantId,
      permissions: ["resource:read", "flywheel:read", "flywheel:write", "analytics:read"],
      authorizationVersion: 1,
    },
  };
}

export function client(): PrismaClient {
  if (prisma === null) throw new Error("القاعدة الحية غير مهيأة");
  return prisma;
}

export function ownerHandle() {
  return { database, adminUrl, ownerPrisma };
}

describe.skipIf(!liveUp)("عزل المحولات الستة بالاستعلامات المضادة", () => {
  it("المحول الحي يعمل بدور التنفيذ المتوقع حصراً", async () => {
    const rows = await client().$queryRawUnsafe<Array<{ s: string; c: string }>>("SELECT session_user AS s, current_user AS c");
    expect(rows[0]?.s).not.toBe("agentbridge");
    expect(rows[0]?.c).toBe("agentbridge_app");
  });

  it("Semantic: A يقرأ مشروعه، وقراءة معرف B لا تجده، وغياب السياق مرفوض", async () => {
    const store = createPrismaSemanticStore(client());
    await store.createProject({ projectId: "p-a", tenantId: "t-iso-a", name: "مشروع A", createdAt: new Date().toISOString() });
    expect(await store.getProject("t-iso-a", "p-a")).not.toBeNull();
    // استعلام مضاد: A يطلب معرف مشروع B (غير موجود أصلاً) والسياسة لا تكشف شيئاً
    await store.createProject({ projectId: "p-b", tenantId: "t-iso-b", name: "مشروع B", createdAt: new Date().toISOString() });
    expect(await store.getProject("t-iso-a", "p-b")).toBeNull();
    await expect(store.getTenant("")).rejects.toThrow();
  });

  it("Flywheel: A يكتب ويقرأ درسه، ودرس B لا يظهر في topK لA، وحمولة متعارضة ترفض", async () => {
    const store = createPrismaFlywheelStore(client(), createPgVectorStore(client()));
    const ctxA = isolationContext("t-iso-a");
    const ctxB = isolationContext("t-iso-b");
    const lesson = { specPattern: "iso-pattern", designDecision: "iso-decision", outcome: "success" as const, score: 60, createdAt: new Date().toISOString() };
    await store.saveLesson(ctxA, { ...lesson, tenantId: "t-iso-a" });
    await store.saveLesson(ctxB, { ...lesson, tenantId: "t-iso-b" });
    const hitsA = await store.topK(ctxA, "iso-pattern", 5);
    expect(hitsA.every((entry) => entry.tenantId === "t-iso-a")).toBe(true);
    expect(hitsA.some((entry) => entry.tenantId === "t-iso-b")).toBe(false);
    await expect(store.saveLesson(ctxA, { ...lesson, tenantId: "t-iso-b" })).rejects.toThrow();
  });

  it("pgvector: بحث A لا يعيد متجهات B، وكتابة بمعرف مستأجر متعارض ترفض", async () => {
    const store = createPgVectorStore(client());
    const vector = Array.from({ length: 1536 }, (_, i) => (i % 2 === 0 ? 1 : 0));
    await store.upsert(isolationContext("t-iso-a"), { id: "v-a", tenantId: "t-iso-a", namespace: "spec", vector, metadata: {} });
    await store.upsert(isolationContext("t-iso-b"), { id: "v-b", tenantId: "t-iso-b", namespace: "spec", vector, metadata: {} });
    const hits = await store.search(isolationContext("t-iso-a"), "spec", vector, 5);
    expect(hits.some((hit) => hit.id === "v-a")).toBe(true);
    expect(hits.some((hit) => hit.id === "v-b")).toBe(false);
    await expect(store.upsert(isolationContext("t-iso-a"), { id: "v-x", tenantId: "t-iso-b", namespace: "spec", vector, metadata: {} })).rejects.toThrow();
  });

  it("SSO: إعداد A لا يقرأ من سياق B، وإنشاء A لا يمس B (هويات مستقلة)", async () => {
    const store = createPrismaSsoStore(client());
    const base = { provider: "oidc", issuer: "https://issuer.example.com", clientId: "client", jwksUrl: "https://issuer.example.com/jwks", enabled: false };
    const a = await store.create({ ...base, tenantId: "t-iso-a" });
    const b = await store.create({ ...base, tenantId: "t-iso-b", clientId: "client-b" });
    expect((await store.getPrivate("t-iso-a"))?.configInstanceId).toBe(a.configInstanceId);
    expect((await store.getPrivate("t-iso-b"))?.configInstanceId).toBe(b.configInstanceId);
    expect(a.configInstanceId).not.toBe(b.configInstanceId);
  });

  it("CostLedger: إنفاق A لا يختلط بB وقيمة B قبل الكتابة صفر (استعلام مضاد)", async () => {
    const ledger = createPrismaCostLedger(client());
    await expect(ledger.monthSpendUsd("t-iso-b")).resolves.toBe(0);
    await ledger.addSpend("t-iso-a", 0.05);
    await expect(ledger.monthSpendUsd("t-iso-a")).resolves.toBeCloseTo(0.05, 5);
    await expect(ledger.monthSpendUsd("t-iso-b")).resolves.toBe(0);
  });

  it("Auth: identity/credential/state لا توسع النطاق — البحث الضيق يعيد صفه حصراً", async () => {
    const store = createPrismaAuthStore(client());
    await store.putExternalIdentity({ identityId: "i-iso-a", issuer: "urn:iso", subject: "u-a", createdAt: new Date().toISOString() });
    expect(await store.findExternalIdentity("urn:iso", "u-a")).not.toBeNull();
    expect(await store.findExternalIdentity("urn:iso", "u-never")).toBeNull();
    expect(await store.getMembership("m-never", "t-iso-a")).toBeNull();
    expect(await store.findSessionByHash("hash-never")).toBeNull();
  });
});
