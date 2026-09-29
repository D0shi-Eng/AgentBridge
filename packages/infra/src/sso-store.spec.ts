/**
 * اختبارات مخزن SSO داخل الذاكرة — عقد CAS المركب.
 * هذه هي الوجهة InMemory من العقد؛ الوجهة الحية بالدور المقيد في
 * tests/e2e/sso-cas-live.spec.ts وتطبق المعنى نفسه حرفياً.
 */
import { describe, expect, it } from "vitest";
import {
  createInMemorySsoStore, generateConfigInstanceId, SsoConfigConflictError,
  SsoConfigNotFoundError, type SsoConfigWriteInput,
} from "./sso-store.js";

const baseInput: SsoConfigWriteInput = {
  tenantId: "tenant-1",
  provider: "oidc",
  issuer: "https://issuer.example.com",
  clientId: "client-123",
  jwksUrl: "https://issuer.example.com/.well-known/jwks.json",
  enabled: true,
};

function expectationOf(instanceId: string, version: number) {
  return { expectedInstanceId: instanceId, expectedVersion: version };
}

describe("createInMemorySsoStore — عقد CAS المركب", () => {
  it("create يولد هوية خادمية وإصدار 1 — والعميل لا يختار الهوية", async () => {
    const store = createInMemorySsoStore();
    const created = await store.create(baseInput);
    expect(created.configVersion).toBe(1);
    expect(created.configInstanceId).toMatch(/^[0-9a-f]{32}$/u);
    expect(generateConfigInstanceId()).not.toBe(created.configInstanceId);
  });

  it("create على مستأجر له سجل = تعارض صريح (SSO_CONFIG_CONFLICT)", async () => {
    const store = createInMemorySsoStore();
    await store.create(baseInput);
    await expect(store.create(baseInput)).rejects.toBeInstanceOf(SsoConfigConflictError);
  });

  it("update صحيح يحافظ على الهوية ويرفع الإصدار داخل العملية", async () => {
    const store = createInMemorySsoStore();
    const created = await store.create(baseInput);
    const updated = await store.update({ ...baseInput, enabled: false }, expectationOf(created.configInstanceId, 1));
    expect(updated.configInstanceId).toBe(created.configInstanceId);
    expect(updated.configVersion).toBe(2);
    expect(updated.enabled).toBe(false);
  });

  it("update بإصدار قديم ⇒ تعارض، وبإصدار متساوٍ وهوية قديمة ⇒ تعارض (إغلاق ABA)", async () => {
    const store = createInMemorySsoStore();
    const created = await store.create(baseInput);
    await store.update({ ...baseInput }, expectationOf(created.configInstanceId, 1));
    await expect(store.update(baseInput, expectationOf(created.configInstanceId, 1)))
      .rejects.toBeInstanceOf(SsoConfigConflictError);
    // هوية أخرى مع إصدار مطابق — المقارنة المركبة ترفض لا الإصدار وحده
    await expect(store.update(baseInput, expectationOf(generateConfigInstanceId(), 2)))
      .rejects.toBeInstanceOf(SsoConfigConflictError);
  });

  it("delete ثم recreate يولدان هوية جديدة — المعاملة القديمة ترفض تحديثاً وحذفاً", async () => {
    const store = createInMemorySsoStore();
    const first = await store.create(baseInput);
    expect(await store.delete("tenant-1")).toBe(true);
    const second = await store.create({ ...baseInput, enabled: false });
    expect(second.configInstanceId).not.toBe(first.configInstanceId);
    expect(second.configVersion).toBe(1);
    await expect(store.update(baseInput, expectationOf(first.configInstanceId, 1)))
      .rejects.toBeInstanceOf(SsoConfigConflictError);
    await expect(store.delete("tenant-1", expectationOf(first.configInstanceId, 1)))
      .rejects.toBeInstanceOf(SsoConfigConflictError);
  });

  it("الغياب منفصل عن التعارض: update على غائب يرمي NotFound وdelete يعيد false", async () => {
    const store = createInMemorySsoStore();
    await expect(store.update(baseInput, expectationOf(generateConfigInstanceId(), 1)))
      .rejects.toBeInstanceOf(SsoConfigNotFoundError);
    await expect(store.delete("tenant-1")).resolves.toBe(false);
  });

  it("delete بلا توقع يحذف، وبتوقع صحيح يحذف، وبعد التغيير يرفض", async () => {
    const store = createInMemorySsoStore();
    const created = await store.create(baseInput);
    await expect(store.delete("tenant-1", expectationOf(created.configInstanceId, 1))).resolves.toBe(true);
    const second = await store.create(baseInput);
    await store.update({ ...baseInput }, expectationOf(second.configInstanceId, 1));
    await expect(store.delete("tenant-1", expectationOf(second.configInstanceId, 1)))
      .rejects.toBeInstanceOf(SsoConfigConflictError);
  });

  it("المغلف يمرر صراحة — غيابه في التحديث يفرغه لا يحمله", async () => {
    const store = createInMemorySsoStore();
    const created = await store.create({ ...baseInput, clientSecretEnvelope: "v1:k:iv:tag:ct" });
    expect(created.clientSecretConfigured).toBe(true);
    const cleared = await store.update({ ...baseInput }, expectationOf(created.configInstanceId, 1));
    expect(cleared.clientSecretConfigured).toBe(false);
    const kept = await store.update(
      { ...baseInput, clientSecretEnvelope: "v1:k2:iv:tag:ct" }, expectationOf(created.configInstanceId, 2));
    expect(kept.clientSecretConfigured).toBe(true);
    expect(await store.getPrivate("tenant-1").then((c) => c?.clientSecretEnvelope)).toBe("v1:k2:iv:tag:ct");
  });

  it("عزل المستأجرين بنيوياً في المخزن نفسه", async () => {
    const store = createInMemorySsoStore();
    const a = await store.create(baseInput);
    const b = await store.create({ ...baseInput, tenantId: "tenant-2", clientId: "client-456" });
    expect(a.configInstanceId).not.toBe(b.configInstanceId);
    expect((await store.get("tenant-1"))?.clientId).toBe("client-123");
    expect((await store.get("tenant-2"))?.clientId).toBe("client-456");
  });
});
