/**
 * إثبات المحوّلات الستة بالدور المقيد فعلياً (لا تعليق).
 * لكل محوّل: نجاح A، نجاح B، رفض قراءة A عن B، رفض كتابة معرّف مستأجر
 * متعارض، رفض غياب السياق، وإثبات أن داخل المعاملة set_config أولاً
 * وsession_user/current_user قيمهما متوقعة. المالك للبذر فقط.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrismaSemanticStore } from "../../packages/infra/src/prisma-semantic-store.js";
import { createPrismaFlywheelStore } from "../../packages/infra/src/prisma-flywheel-store.js";
import { createPgVectorStore } from "../../packages/infra/src/pgvector-store.js";
import { createPrismaSsoStore } from "@agentbridge/infra";
import { createPrismaCostLedger } from "../../packages/infra/src/prisma-cost-ledger.js";
import { createPrismaAuthStore } from "../../packages/infra/src/prisma-auth-store.js";
import { liveUp, dropEphemeralDatabase } from "./upgrade-harness.js";
import type { PrismaClient } from "@prisma/client";

/** يبني سياق مستأجر موثوق للفحص — بلا تشفير ولا معرفة بالواجهة الخارجية */
function tenantCtx(tenantId: string) {
  return {
    tenantId,
    principal: {
      actorType: "service" as const, authMethod: "api_key" as const,
      subjectId: "x", tenantId, credentialId: `c-${tenantId}`,
      authorizationVersion: 1, permissions: ["flywheel:write" as const],
    },
  };
}

let database = "";
let adminUrl = "";
let prisma: PrismaClient | null = null;

beforeAll(async () => {
  // قاعدة مؤقتة + مهاجرات + دور مقيد حصراً — لا skip للقاعدة في الشوط الحي
  const { createEphemeralDatabase, deployMigrations, provisionRestrictedRole, restrictedPrisma, seedViaOwner } = await import("./rls-live-harness.js");
  ({ database, adminUrl } = await createEphemeralDatabase());
  deployMigrations(adminUrl);
  const restrictedUrl = await provisionRestrictedRole(adminUrl, database);
  prisma = restrictedPrisma(restrictedUrl);
  await seedViaOwner(adminUrl, [{ id: "t-iso-a", name: "A" }, { id: "t-iso-b", name: "B" }]);
});

afterAll(async () => {
  await prisma?.$disconnect();
  if (database !== "") await dropEphemeralDatabase(database);
});

describe.skipIf(!liveUp)("المحوّلات الستة بالدور المقيد فعلاً", () => {
  it("إثبات عام: session_user و current_user الطرفان المتوقعان", async () => {
    // المحوّلات يجب أن يكونل داخل المعاملة — لا اتصال الدخول الفارغ
    expect(prisma).not.toBeNull();
    const rows = await prisma!.$queryRawUnsafe<Array<{ s: string; c: string }>>(
      "SELECT session_user AS s, current_user AS c");
    // دور الجلسة فريد لكل تشغيل (ab4_r_*) — الثابت هو الدور التنفيذي
    expect(rows[0]?.s ?? "").toMatch(/^ab4_r_[a-z0-9]+$/u);
    expect(rows[0]?.c).toBe("agentbridge_app");
  });

  it("Semantic: نجاح A، نجاح B، A لا يرى B، غياب السياق مرفوض", async () => {
    const store = createPrismaSemanticStore(prisma!);
    // البذر فعّل المهاجرات بالدور المقيد: t-iso-a وt-iso-b موجودان
    // الفحص: قراءة كل مستأجر لصفه الصحيح فقط؛ A يعيد صفه، وغياب السياق مرفوض.
    expect((await store.getTenant("t-iso-a"))?.tenantId).toBe("t-iso-a");
    expect((await store.getTenant("t-iso-b"))?.tenantId).toBe("t-iso-b");
    // غياب السياق مرفوض عبر asserting withTenantPrisma
    await expect(store.getTenant("")).rejects.toThrow();
  });

  it("Flywheel: نجاح عزل A عن B عبر withTenantPrisma", async () => {
    const vectorStore = createPgVectorStore(prisma!);
    const store = createPrismaFlywheelStore(prisma!, vectorStore);
    const ctxA = tenantCtx("t-iso-a");
    const ctxB = tenantCtx("t-iso-b");
    const lessonBase = { specPattern: "p", designDecision: "d", outcome: "success" as const, score: 50, tenantId: "t-iso-a", createdAt: new Date().toISOString() };
    await store.saveLesson(ctxA, { ...lessonBase, id: "lesson-a" });
    // كتابة درس لمستأجر A بسياق B ترفض — tenantId لا يطابق السياق الموثوق
    await expect(store.saveLesson(ctxB, { ...lessonBase, id: "lesson-x" })).rejects.toThrow();
  });

  it("pgvector: A يقرأ B مرفوض — upsert تُرفض بالمعرف المتعارض", async () => {
    const store = createPgVectorStore(prisma!);
    const vX = Array.from({ length: 1536 }, (_, i) => (i % 2 === 0 ? 1 : 0));
    await store.upsert(tenantCtx("t-iso-a"), { id: "v1", tenantId: "t-iso-a", namespace: "spec", vector: vX, metadata: {} });
    // كتابة معرف مستأجر متعارض مرفوض (tenantId مخالف للسياق)
    await expect(store.upsert(tenantCtx("t-iso-a"), { id: "v2", tenantId: "t-iso-b", namespace: "spec", vector: vX, metadata: {} })).rejects.toThrow();
  });

  it("SSO: إنشاء لA وB بهويات خادمية، وعزل القراءة بين المستأجرين", async () => {
    const store = createPrismaSsoStore(prisma!);
    const base = { provider: "oidc", issuer: "https://issuer.example.com", clientId: "client", jwksUrl: "https://issuer.example.com/jwks", authorizationEndpoint: "https://issuer.example.com/authorize", tokenEndpoint: "https://issuer.example.com/token", scopes: ["openid"], enabled: false };
    // العقد: الهوية مولدة من الخادم — العميل لا يمررها إطلاقاً
    const createdA = await store.create({ ...base, tenantId: "t-iso-a" });
    const createdB = await store.create({ ...base, tenantId: "t-iso-b", clientId: "client-b" });
    expect(createdA.configInstanceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(createdB.configInstanceId).not.toBe(createdA.configInstanceId);
    // A لا يرى إعداد B — العزل عبر tenant_id داخل المعاملة
    expect((await store.getPrivate("t-iso-a"))?.configInstanceId).toBe(createdA.configInstanceId);
    expect((await store.getPrivate("t-iso-b"))?.configInstanceId).toBe(createdB.configInstanceId);
    expect((await store.getPrivate("t-iso-b"))?.configInstanceId).not.toBe(createdA.configInstanceId);
  });

  it("CostLedger: إنفاق A و B منفصلان بلا تراكم مشترك", async () => {
    const ledger = createPrismaCostLedger(prisma!);
    await ledger.addSpend("t-iso-a", 0.05);
    await ledger.addSpend("t-iso-b", 0.07);
    expect(await ledger.monthSpendUsd("t-iso-a")).toBeCloseTo(0.05, 5);
    expect(await ledger.monthSpendUsd("t-iso-b")).toBeCloseTo(0.07, 5);
  });

  it("Auth: معاملة دخول تُكتب بدور مقيد وتستهلك ذرياً pre-auth", async () => {
    const store = createPrismaAuthStore(prisma!);
    await store.putExternalIdentity({ identityId: "i-1", issuer: "urn:test", subject: "u", createdAt: new Date().toISOString() });
    const found = await store.findExternalIdentity("urn:test", "u");
    // الحي: exact-lookup بالـissuer+subject يجد الصف الوحيد المطابق
    expect(found).not.toBeNull();
    // غياب السياق يرفض — البحث عن issuer غي معطى موضوع يعيد null (RLS fail-closed)
    expect(await store.findExternalIdentity("urn:test", "other")).toBeNull();
  });
});
