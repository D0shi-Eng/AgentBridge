/**
 * اختبارات مدقق OIDC — verifyOidcToken + signOidcToken.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { setupJwksNetwork, mockJwks, mockJwksFailure, getTestKeyPair } from "./jwks/test-support.js";
setupJwksNetwork();
import { signOidcToken, verifyOidcToken } from "./oidc-verifier.js";

describe("verifyOidcToken", () => {
  let keys: { publicKey: Record<string, unknown>; privateKey: Record<string, unknown> };

  beforeEach(async () => {
    const kp = await getTestKeyPair();
    if (!kp) throw new Error("keys not generated");
    keys = kp;
  });

  it("يرفض JWT بصيغة خاطئة", async () => {
    const result = await verifyOidcToken("invalid", "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_TOKEN_INVALID");
  });

  it("يرفض خوارزمية غير RS256", async () => {
    const token = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.dummy";
    mockJwks({ keys: [] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_TOKEN_INVALID");
  });

  it("يرفض توكن منتهي الصلاحية", async () => {
    const payload = { sub: "user1", exp: Math.floor(Date.now() / 1000) - 3600, aud: "client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_TOKEN_INVALID");
  });

  it("يرفض توكن بـ iss غير مطابق", async () => {
    const payload = { sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600, aud: "client", iss: "https://other-issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_ISSUER_MISMATCH");
  });

  it("يرفض توكن بـ aud غير مطابق", async () => {
    const payload = { sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600, aud: "other-client", iss: "https://issuer" };
    const token = signOidcToken(payload, keys.privateKey, "test-kid");
    mockJwks({ keys: [{ ...keys.publicKey, kid: "test-kid", alg: "RS256" }] });
    const result = await verifyOidcToken(token, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_TOKEN_INVALID");
  });

  it("يرفض عندما يفشل جلب JWKS", async () => {
    mockJwksFailure();
    const fakeHeader = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" }), "utf8").toString("base64url");
    const fakePayload = Buffer.from(JSON.stringify({ sub: "user1", exp: Math.floor(Date.now() / 1000) + 3600 }), "utf8").toString("base64url");
    const fakeToken = `${fakeHeader}.${fakePayload}.signature`;
    const result = await verifyOidcToken(fakeToken, "https://jwks.example.com", "https://issuer", "client");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("SSO_JWKS_FAILED");
  });
});

