/** فحوص المطالبات والتوقيع عبر قناة JWKS المحمية بشبكة اصطناعية. */
import { describe, expect, it, beforeEach } from "vitest";
import { signOidcToken, verifyOidcToken } from "./oidc-verifier.js";
import { setupJwksNetwork, mockJwks, getTestKeyPair } from "./jwks/test-support.js";
setupJwksNetwork();

describe("verifyOidcToken — تغطية فروع إضافية", () => {
  let keys: { publicKey: Record<string, unknown>; privateKey: Record<string, unknown> };

  beforeEach(async () => {
    const kp = await getTestKeyPair();
    if (!kp) throw new Error("keys not generated");
    keys = kp;
  });

  it("يقبل aud كمصفوفة تحتوي على clientId", async () => {
    const payload = { sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600, aud: ["client", "other"], azp: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(true);
  });

  it("يرفض exp غير عدد صحيح", async () => {
    const payload = { sub: "user1", exp: "not-a-number", aud: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_TOKEN_INVALID");
  });

  it("يرفض sub مفقود", async () => {
    const payload = { exp: Math.floor(Date.now() / 1000) + 3600, aud: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_TOKEN_INVALID");
  });

  it("يستخرج email عند وجودها", async () => {
    const payload = { sub: "user1", email: "test@example.com", exp: Math.floor(Date.now() / 1000) + 3600, aud: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.email).toBe("test@example.com");
  });

  it("يتجاهل tid ولا يحوله إلى مستأجر موثوق", async () => {
    const payload = { sub: "user1", tid: "tenant-from-tid", exp: Math.floor(Date.now() / 1000) + 3600, aud: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(true);
    if (result.ok) expect("tenantId" in result.value).toBe(false);
  });

  it("يتجاهل tenantId القادم من الرمز", async () => {
    const payload = { sub: "user1", tenantId: "tenant-from-tenantId", exp: Math.floor(Date.now() / 1000) + 3600, aud: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(true);
    if (result.ok) expect("tenantId" in result.value).toBe(false);
  });

  it("يرفض عند فشل تحقق التوقيع", async () => {
    // استخدم مفتاح عام مختلف للتوقيع عن مفتاح التحقق
    const { generateKeyPair } = await import("node:crypto");
    const otherKeys = await new Promise<{ publicKey: Record<string, unknown>; privateKey: Record<string, unknown> }>((resolve) => {
      generateKeyPair("rsa", { modulusLength: 2048 }, (err: Error | null, publicKey: unknown, privateKey: unknown) => {
        if (err) throw err;
        resolve({
          publicKey: (publicKey as { export: (opts: { format: string }) => Record<string, unknown> }).export({ format: "jwk" }),
          privateKey: (privateKey as { export: (opts: { format: string }) => Record<string, unknown> }).export({ format: "jwk" }),
        });
      });
    });
    const payload = { sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600, aud: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, otherKeys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("SSO_TOKEN_INVALID");
      expect(result.error.message).toContain("توقيع غير صالح");
    }
  });

  it("يرفض المفتاح التالف قبل crypto", async () => {
    const payload = { sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600, aud: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ kty: "RSA", kid: "test-kid", n: "invalid", e: "AQAB", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_JWKS_FAILED");
  });
});

describe("signOidcToken", () => {
  let keys: { publicKey: Record<string, unknown>; privateKey: Record<string, unknown> };

  beforeEach(async () => {
    const kp = await getTestKeyPair();
    if (!kp) throw new Error("keys not generated");
    keys = kp;
  });

  it("ينتج JWT بثلاثة أجزاء", async () => {
    const payload = { sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600 };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    expect(token.split(".")).toHaveLength(3);
  });
});
