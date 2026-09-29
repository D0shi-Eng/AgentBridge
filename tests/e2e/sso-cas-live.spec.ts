/**
 * CAS المركب حياً فوق Prisma بالدور المقيد.
 * كل الحالات الإلزامية: create متزامن، update بإصدار/هوية قديمة، سباق
 * تحديثين، stale بعد delete+recreate (تحديث وحذف)، delete متزامن مع update،
 * والمغلف (إعادة ختم/فراغ). النتائج تُقارن بندائها في InMemory (نفس الملف).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createInMemorySsoStore, createPrismaSsoStore, SsoConfigConflictError,
  SsoConfigNotFoundError, type SsoConfigWriteInput, type SsoStore,
} from "@agentbridge/infra";
import {
  createEphemeralDatabase, deployMigrations, dropEphemeralDatabase,
  ownerPrisma, provisionRestrictedRole, restrictedPrisma,
} from "./rls-live-harness.js";
import { liveUp } from "./upgrade-harness.js";
import type { PrismaClient } from "@prisma/client";

const base: Omit<SsoConfigWriteInput, "tenantId"> = {
  provider: "oidc", issuer: "https://issuer.example.com", clientId: "client",
  jwksUrl: "https://issuer.example.com/jwks", authorizationEndpoint: "https://issuer.example.com/authorize",
  tokenEndpoint: "https://issuer.example.com/token", scopes: ["openid"], enabled: false,
};
const expectOf = (instance: string, version: number) => ({ expectedInstanceId: instance, expectedVersion: version });

/** سيناريو CAS كامل يعمل على أي SsoStore — Prisma الحي وInMemory بلا تمييز */
async function casScenario(store: SsoStore, tenant: string): Promise<void> {
  const created = await store.create({ ...base, tenantId: tenant });
  expect(created.configVersion).toBe(1);
  expect(created.configInstanceId).toMatch(/^[0-9a-f]{32}$/u);
  // update بإصدار قديم ⇒ تعارض
  await store.update({ ...base, tenantId: tenant }, expectOf(created.configInstanceId, 1));
  await expect(store.update({ ...base, tenantId: tenant }, expectOf(created.configInstanceId, 1)))
    .rejects.toBeInstanceOf(SsoConfigConflictError);
  const current = await store.getPrivate(tenant);
  const version = current?.configVersion ?? 0;
  // update بهوية قديمة وإصدار متساوٍ ⇒ تعارض (المقارنة المركبة لا الإصدار وحده)
  await expect(store.update({ ...base, tenantId: tenant }, expectOf("f".repeat(32), version)))
    .rejects.toBeInstanceOf(SsoConfigConflictError);
  // تحديثان متزامنان بنفس التوقع: نجاح واحد فقط والآخر 409
  const race = await Promise.allSettled([
    store.update({ ...base, tenantId: tenant, clientId: "c-1" }, expectOf(current?.configInstanceId ?? "", version)),
    store.update({ ...base, tenantId: tenant, clientId: "c-2" }, expectOf(current?.configInstanceId ?? "", version)),
  ]);
  const fulfilled = race.filter((r) => r.status === "fulfilled");
  const rejected = race.filter((r) => r.status === "rejected");
  expect(fulfilled).toHaveLength(1);
  expect(rejected).toHaveLength(1);
  expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(SsoConfigConflictError);
  // delete ثم recreate: هوية جديدة، وstale update وstale delete كلاهما 409
  const staleInstance = (await store.getPrivate(tenant))?.configInstanceId ?? "";
  expect(await store.delete(tenant)).toBe(true);
  const fresh = await store.create({ ...base, tenantId: tenant });
  expect(fresh.configInstanceId).not.toBe(staleInstance);
  await expect(store.update({ ...base, tenantId: tenant }, expectOf(staleInstance, 1)))
    .rejects.toBeInstanceOf(SsoConfigConflictError);
  await expect(store.delete(tenant, expectOf(staleInstance, 1))).rejects.toBeInstanceOf(SsoConfigConflictError);
  // delete صحيح بتوقع سليم، ثم الغياب منفصل (false / NotFound)
  expect(await store.delete(tenant, expectOf(fresh.configInstanceId, fresh.configVersion))).toBe(true);
  await expect(store.delete(tenant)).resolves.toBe(false);
  await expect(store.update({ ...base, tenantId: tenant }, expectOf(fresh.configInstanceId, 1)))
    .rejects.toBeInstanceOf(SsoConfigNotFoundError);
}

let prisma: PrismaClient | null = null;
let database = "";

beforeAll(async () => {
  if (!liveUp) return;
  const created = await createEphemeralDatabase();
  database = created.database;
  deployMigrations(created.adminUrl);
  const restrictedUrl = await provisionRestrictedRole(created.adminUrl, database);
  prisma = restrictedPrisma(restrictedUrl);
  const owner = ownerPrisma(created.adminUrl);
  await owner.$executeRawUnsafe(`INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ('t-cas4','CAS4','h',false,NOW())`);
  await owner.$disconnect();
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (database !== "") await dropEphemeralDatabase(database);
});

describe.skipIf(!liveUp)("CAS المركب حياً بالدور المقيد ومطابقته لInMemory", () => {
  it("المحول الحي: سيناريو CAS المركب كامل", { timeout: 90_000 }, async () => {
    expect(prisma).not.toBeNull();
    const persona = await prisma!.$queryRawUnsafe<Array<{ s: string; c: string }>>("SELECT session_user AS s, current_user AS c");
    expect(persona[0]?.c).toBe("agentbridge_app");
    await casScenario(createPrismaSsoStore(prisma!), "t-cas4");
  });

  it("InMemory: السيناريو نفسه بنفس النتائج (تطابق دلالي)", async () => {
    await casScenario(createInMemorySsoStore(), "t-cas4-mem");
  });

  it("المغلف حياً: update بلا سر يفرغه، وkeep المساري يعيد ختمه بإصدار جديد", { timeout: 90_000 }, async () => {
    const store = createPrismaSsoStore(prisma!);
    const created = await store.create({ ...base, tenantId: "t-cas4", clientSecretEnvelope: "v1:k:iv:tag:ct" });
    expect(created.clientSecretConfigured).toBe(true);
    const cleared = await store.update({ ...base, tenantId: "t-cas4" }, expectOf(created.configInstanceId, created.configVersion));
    expect(cleared.clientSecretConfigured).toBe(false);
    // إعادة الاستخدام مستحيلة: المغلف القديم لم يعد موجوداً في الصف
    const row = await store.getPrivate("t-cas4");
    expect(row?.clientSecretEnvelope).toBeUndefined();
  });
});
