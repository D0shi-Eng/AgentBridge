/**
 * اختبارات مبدئو SSO — التحويل النقي بين سجل النطاق وصف الجدول.
 * العقد الحاسم: صف التحديث يستثني config_instance_id حصراً (لا دهس ABA).
 */
import { describe, expect, it } from "vitest";
import { ssoCreateRow, ssoUpdateRow, ssoFromRow } from "./sso-mappers.js";
import type { SsoConfigWriteInput } from "./sso-store.js";

const input: SsoConfigWriteInput = {
  tenantId: "tenant-1",
  provider: "oidc",
  issuer: "https://issuer.example.com",
  clientId: "client-123",
  jwksUrl: "https://issuer.example.com/.well-known/jwks.json",
  enabled: true,
};

describe("ssoCreateRow / ssoUpdateRow / ssoFromRow", () => {
  it("صف الإنشاء يحمل الهوية الخادمية الممررة وإصدار 1 حصراً", () => {
    const row = ssoCreateRow(input, "a".repeat(32));
    expect(row.tenant_id).toBe("tenant-1");
    expect(row.config_instance_id).toBe("a".repeat(32));
    expect(row.config_version).toBe(1);
    expect(row.created_at).toBeInstanceOf(Date);
    expect(row.client_secret_envelope).toBeNull();
  });

  it("صف التحديث يستثني الهوية حصراً ويرفع الإصدار — لا طريق لدهس الهوية", () => {
    const row = ssoUpdateRow({ ...input, enabled: false }, 7);
    expect("config_instance_id" in row).toBe(false);
    expect(row.config_version).toBe(7);
    expect(row.enabled).toBe(false);
  });

  it("صف التحديث بلا مغلف يفرغ السر وبمغلف يستبدله", () => {
    expect(ssoUpdateRow(input, 2).client_secret_envelope).toBeNull();
    expect(ssoUpdateRow({ ...input, clientSecretEnvelope: "v1:k:iv:tag:ct" }, 2).client_secret_envelope).toBe("v1:k:iv:tag:ct");
  });

  it("ssoFromRow يعيد سجلاً داخلياً بهوية وإصدار مطلوبين", () => {
    const result = ssoFromRow({
      tenant_id: "tenant-1", provider: "oidc", issuer: "https://issuer.example.com",
      client_id: "client-123", jwks_url: "https://issuer.example.com/.well-known/jwks.json",
      config_instance_id: "b".repeat(32), config_version: 4, enabled: true,
      created_at: new Date("2024-01-01T00:00:00.000Z"),
    });
    expect(result.configInstanceId).toBe("b".repeat(32));
    expect(result.configVersion).toBe(4);
    expect(result.clientSecretConfigured).toBeUndefined();
    expect(result.enabled).toBe(true);
  });

  it("ssoFromRow يفك scopes المخزنة ويتسامح مع scopes تالفة بعودة openid", () => {
    const base = { tenant_id: "t", provider: "oidc", issuer: "https://i.example.com", client_id: "c", jwks_url: "https://i.example.com/j", config_instance_id: "c".repeat(32), config_version: 1, enabled: false, created_at: new Date() };
    expect(ssoFromRow({ ...base, scopes: "[\"openid\",\"profile\"]" }).scopes).toEqual(["openid", "profile"]);
    expect(ssoFromRow({ ...base, scopes: "not-json" }).scopes).toEqual(["openid"]);
  });
});
