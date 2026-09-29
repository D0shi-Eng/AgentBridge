/** رحلة OIDC اصطناعية كاملة عبر buildApp: start → callback → cookie → logout. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInMemorySsoStore, signOidcToken } from "@agentbridge/infra";
import { buildApp } from "../app.js";
import { buildContainer, developmentEnv } from "../container.js";
import { seedTenant } from "../test-helpers.js";
import { mockJwks, setupJwksNetwork } from "../plugins/sso-test-network.js";

setupJwksNetwork();
const origin = "http://127.0.0.1:3001";
function cookies(value: string | string[] | undefined): string[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list.map((item) => item.split(";", 1)[0] ?? "").filter(Boolean);
}

describe("رحلة OIDC المتكاملة", () => {
  const root = mkdtempSync(join(tmpdir(), "ab-oidc-journey-"));
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = pair.privateKey.export({ format: "jwk" }) as Record<string, unknown>;
  const publicKey = pair.publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const ssoStore = createInMemorySsoStore();
  let expectedNonce = "";
  // async الحاوية: فحص الدور المقيد fail-closed عند الإقلاع — يُحل في beforeAll
  let container: Awaited<ReturnType<typeof buildContainer>>;
  const appHolder: { app?: ReturnType<typeof buildApp> } = {};
  const app = () => appHolder.app!;

  beforeAll(async () => {
    container = await buildContainer({ env: developmentEnv(), workRoot: root, ssoStore, oidcExchanger: async () => signOidcToken({ sub: "oidc-user", iss: "https://issuer.example.com", aud: "client-123", exp: Math.floor(Date.now() / 1000) + 300, nonce: expectedNonce }, privateKey, "test-kid") });
    appHolder.app = buildApp(container);
    await seedTenant(container, "tenant-oidc", "OIDC");
    await container.authStore.putExternalIdentity({ identityId: "identity:oidc-user", issuer: "https://issuer.example.com", subject: "oidc-user", createdAt: new Date().toISOString() });
    await container.authStore.putMembership({ membershipId: "membership:oidc-user", identityId: "identity:oidc-user", tenantId: "tenant-oidc", role: "reader", status: "active", authorizationVersion: 1 });
    await ssoStore.create({ tenantId: "tenant-oidc", provider: "oidc", issuer: "https://issuer.example.com", clientId: "client-123", jwksUrl: "https://issuer.example.com/keys", authorizationEndpoint: "https://issuer.example.com/authorize", tokenEndpoint: "https://issuer.example.com/token", scopes: ["openid"], enabled: true });
  });
  beforeEach(() => { mockJwks({ keys: [{ ...publicKey, kid: "test-kid", alg: "RS256" }] }); });
  afterAll(async () => { await app().close(); rmSync(root, { recursive: true, force: true }); });

  it("ينشئ جلسة قابلة للاستخدام ثم يلغيها ويمنع replay", async () => {
    const start = await app().inject({ method: "POST", url: "/auth/oidc/start", headers: { origin }, payload: { tenantId: "tenant-oidc", returnPath: "/app" } });
    expect(start.statusCode).toBe(200);
    const authorization = new URL(start.json().authorizationUrl as string);
    expectedNonce = authorization.searchParams.get("nonce") ?? "";
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    const state = authorization.searchParams.get("state") ?? "";
    const loginCookie = cookies(start.headers["set-cookie"]).join("; ");
    const callback = await app().inject({ method: "GET", url: `/auth/oidc/callback?code=synthetic&state=${encodeURIComponent(state)}`, headers: { cookie: loginCookie } });
    expect(callback.statusCode).toBe(303);
    const sessionCookies = cookies(callback.headers["set-cookie"]);
    const cookie = sessionCookies.join("; ");
    expect((await app().inject({ method: "GET", url: "/projects", headers: { cookie } })).statusCode).toBe(200);
    const csrf = decodeURIComponent(sessionCookies.find((item) => item.startsWith("ab_csrf="))?.slice(8) ?? "");
    expect((await app().inject({ method: "POST", url: "/auth/logout", headers: { cookie, origin, "x-csrf-token": csrf } })).statusCode).toBe(200);
    expect((await app().inject({ method: "GET", url: "/projects", headers: { cookie } })).statusCode).toBe(401);
    expect((await app().inject({ method: "GET", url: `/auth/oidc/callback?code=again&state=${encodeURIComponent(state)}`, headers: { cookie: loginCookie } })).statusCode).toBe(401);
  });

  it("يرفض returnPath خارجياً وبدءاً من Origin غير موثوق", async () => {
    expect((await app().inject({ method: "POST", url: "/auth/oidc/start", headers: { origin }, payload: { tenantId: "tenant-oidc", returnPath: "//evil.example" } })).statusCode).toBe(400);
    expect((await app().inject({ method: "POST", url: "/auth/oidc/start", headers: { origin: "https://evil.example" }, payload: { tenantId: "tenant-oidc", returnPath: "/app" } })).statusCode).toBe(403);
  });
});
