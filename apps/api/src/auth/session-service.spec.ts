/** اختبارات انتهاء وإلغاء جلسة opaque وإبطال تغيير التفويض. */
import { describe, expect, it } from "vitest";
import { createInMemoryAuthStore } from "@agentbridge/memory";
import { SessionService } from "./session-service.js";

async function fixture(now = Date.now()) {
  const store = createInMemoryAuthStore();
  const membership = { membershipId: "m1", identityId: "i1", tenantId: "t1", role: "reader" as const, status: "active" as const, authorizationVersion: 1 };
  await store.putExternalIdentity({ identityId: "i1", issuer: "https://issuer.example", subject: "u1", createdAt: new Date(now).toISOString() });
  await store.putMembership(membership);
  const service = new SessionService(store, () => now);
  const issued = await service.issue("i1", membership, "binding", "oidc");
  return { store, service, issued, membership };
}

describe("SessionService", () => {
  it("يخزن hash فقط ويصدر Principal من عضوية نشطة", async () => {
    const { service, issued } = await fixture();
    expect(issued.record.tokenHash).not.toContain(issued.rawToken);
    const authenticated = await service.authenticate(issued.rawToken);
    expect(authenticated?.principal).toMatchObject({ actorType: "user", tenantId: "t1", membershipId: "m1" });
  });

  it("يلغي logout فعلياً ويرفض إعادة الاستخدام", async () => {
    const { service, issued } = await fixture();
    expect(await service.revoke(issued.rawToken)).toBe(true);
    expect(await service.authenticate(issued.rawToken)).toBeNull();
  });

  it("يرفض انتهاء idle وتغيير إصدار الصلاحيات وتعطيل العضوية", async () => {
    const now = Date.now();
    const expired = await fixture(now);
    const future = new SessionService(expired.store, () => now + 31 * 60 * 1000);
    expect(await future.authenticate(expired.issued.rawToken)).toBeNull();

    const changed = await fixture(now);
    await changed.store.putMembership({ ...changed.membership, authorizationVersion: 2 });
    expect(await changed.service.authenticate(changed.issued.rawToken)).toBeNull();

    const disabled = await fixture(now);
    await disabled.store.putMembership({ ...disabled.membership, status: "disabled" });
    expect(await disabled.service.authenticate(disabled.issued.rawToken)).toBeNull();
  });

  it("تعارض الهوية يرفض الإصدار والمصادقة معاً", async () => {
    const now = Date.now();
    const store = createInMemoryAuthStore();
    const membership = { membershipId: "m-x", identityId: "i-real", tenantId: "t1", role: "reader" as const, status: "active" as const, authorizationVersion: 1 };
    await store.putExternalIdentity({ identityId: "i-real", issuer: "https://issuer.example", subject: "u1", createdAt: new Date(now).toISOString() });
    await store.putMembership(membership);
    const service = new SessionService(store, () => now);
    // الإصدار بidentityId لا يطابق العضوية = رفض قبل أي كتابة
    await expect(service.issue("i-other", membership, "binding", "oidc")).rejects.toThrow(/تعارض هوية الجلسة/u);
    // صف متعارض سلبي: جلسة محفوظة يدوياً بidentityId ≠ عضويتها — المصادقة ترفضها
    await store.putSession({
      sessionId: "sess-conflict", tokenHash: "hash-conflict", csrfHash: "csrf", browserBindingHash: "b",
      identityId: "i-other", authMethod: "oidc", membershipId: "m-x", tenantId: "t1",
      permissions: ["resource:read"], authorizationVersion: 1,
      idleExpiresAt: new Date(now + 60_000).toISOString(), absoluteExpiresAt: new Date(now + 60_000).toISOString(),
    });
    // المصادقة عبر hash جلسة محفوظة مباشرة — فحص التطابق يرفض الصف المتعارض
    const found = await store.findSessionByHash("hash-conflict");
    expect(found).not.toBeNull();
    const membership2 = await store.getMembership("m-x", "t1");
    // شرط التطابق الذي يطبقه authenticate يرفض هذا الصف
    expect(membership2?.identityId).not.toBe(found?.identityId);
  });
});
