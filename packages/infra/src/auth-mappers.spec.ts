/** يتحقق من رفض صفوف الهوية غير الموثوقة وتحويل التواريخ دون فقد. */
import { describe, expect, it } from "vitest";
import { credentialFromRow, identityFromRow, membershipFromRow, sessionFromRow, transactionFromRow } from "./auth-mappers.js";

const DATE = new Date("2026-09-06T00:00:00.000Z");

describe("auth-mappers", () => {
  it("يحول الهوية والعضوية", () => {
    expect(identityFromRow({ id: "i1", issuer: "https://idp.example", subject: "s1", created_at: DATE })).toMatchObject({ identityId: "i1", createdAt: DATE.toISOString() });
    expect(membershipFromRow({ id: "m1", identity_id: "i1", tenant_id: "t1", role: "tenant_admin", status: "active", authorization_version: 2 })).toMatchObject({ membershipId: "m1", role: "tenant_admin", authorizationVersion: 2 });
  });

  it("يرفض الدور والحالة غير المعروفين", () => {
    expect(() => membershipFromRow({ id: "m1", identity_id: "i1", tenant_id: "t1", role: "root", status: "active", authorization_version: 1 })).toThrow();
    expect(() => membershipFromRow({ id: "m1", identity_id: "i1", tenant_id: "t1", role: "viewer", status: "pending", authorization_version: 1 })).toThrow();
  });

  it("يحول الاعتماد والجلسة ويتحقق من الصلاحيات وطريقة المصادقة", () => {
    const credential = credentialFromRow({ id: "c1", tenant_id: "t1", subject_id: "svc", key_hash: "hash", permissions: ["resource:read"], authorization_version: 1, revoked_at: DATE, expires_at: null });
    expect(credential.revokedAt).toBe(DATE.toISOString());
    const base = { id: "x1", token_hash: "token", csrf_hash: "csrf", browser_binding_hash: "browser", identity_id: "i1", membership_id: "m1", tenant_id: "t1", permissions: ["resource:read"], authorization_version: 1, idle_expires_at: DATE, absolute_expires_at: DATE, revoked_at: null };
    expect(sessionFromRow({ ...base, auth_method: "oidc" }).authMethod).toBe("oidc");
    expect(() => sessionFromRow({ ...base, auth_method: "password" })).toThrow();
    expect(() => credentialFromRow({ id: "c1", tenant_id: "t1", subject_id: "svc", key_hash: "hash", permissions: ["root"], authorization_version: 1, revoked_at: null, expires_at: null })).toThrow();
  });

  it("يحول معاملة الدخول المستهلكة ويتحقق من هوية دورة الإعداد", () => {
    const result = transactionFromRow({ id: "tx1", state_hash: "state", browser_binding_hash: "browser", tenant_id: "t1", config_version: 3, config_instance_id: "inst-1", nonce: "nonce", verifier_envelope: "envelope", redirect_uri: "https://app.example/callback", return_path: "/app", expires_at: DATE, consumed_at: DATE });
    expect(result).toMatchObject({ transactionId: "tx1", configVersion: 3, configInstanceId: "inst-1", consumedAt: DATE.toISOString() });
  });
});
