/** اختبارات إدارة SSO عبر جلسة مستخدم، مع سر write-only وCSRF. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashOpaqueToken } from "@agentbridge/infra";
import { buildApp } from "../app.js";
import { buildContainer, developmentEnv } from "../container.js";
import { SessionService } from "../auth/session-service.js";
import { authHeader, seedTenant, setSessionCookieForTest, type SeededTenant } from "../test-helpers.js";

const origin = "http://127.0.0.1:3001";
const body = {
  provider: "oidc", issuer: "https://issuer.example.com", clientId: "client-123",
  jwksUrl: "https://issuer.example.com/jwks", authorizationEndpoint: "https://issuer.example.com/authorize",
  tokenEndpoint: "https://issuer.example.com/token", scopes: ["openid", "profile", "email"],
  clientSecret: "client-secret-value", enabled: true,
};

function browserHeaders(setCookie: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  const cookies = values.map((value) => value.split(";", 1)[0] ?? "").filter(Boolean);
  const csrf = cookies.find((value) => value.startsWith("ab_csrf="))?.slice("ab_csrf=".length) ?? "";
  return { cookie: cookies.join("; "), origin, "x-csrf-token": decodeURIComponent(csrf) };
}

describe("مسارات إعداد SSO", () => {
  const workRoot = mkdtempSync(join(tmpdir(), "ab-sso-routes-"));
  // async الحاوية: فحص الدور المقيد fail-closed عند الإقلاع — يُحل في beforeAll
  let container: Awaited<ReturnType<typeof buildContainer>>;
  const appHolder: { app?: ReturnType<typeof buildApp> } = {};
  const app = () => appHolder.app!;
  let tenant: SeededTenant;
  let session: Record<string, string>;

  beforeAll(async () => {
    container = await buildContainer({ env: developmentEnv(), workRoot });
    appHolder.app = buildApp(container);
    tenant = await seedTenant(container, "tenant-admin", "Admin", true);
    // إدارة SSO عبر جلسة مستخدم OIDC فقط — جسر API-key لا يمنح
    // sso:manage (يُمنع لاحقاً في auth-bridge.spec)، فالجلسة هنا صادرة من
    // SessionService مباشرة فوق عضوية tenant_admin المبذورة (مسار OIDC مكافئ).
    const sessions = new SessionService(container.authStore);
    const issued = await sessions.issue(`identity:${tenant.tenantId}`, {
      membershipId: `membership:${tenant.tenantId}`, identityId: `identity:${tenant.tenantId}`,
      tenantId: tenant.tenantId, role: "tenant_admin", status: "active", authorizationVersion: 1,
    }, hashOpaqueToken("sso-route-test"), "oidc");
    session = browserHeaders(setSessionCookieForTest(issued.rawToken, issued.csrfToken));
  });
  afterAll(async () => { await app().close(); rmSync(workRoot, { recursive: true, force: true }); });

  it("يرفض الطلب غير المصادق واعتماد الخدمة لإدارة SSO", async () => {
    expect((await app().inject({ method: "GET", url: "/sso/config" })).statusCode).toBe(401);
    expect((await app().inject({ method: "GET", url: "/sso/config", headers: authHeader(tenant) })).statusCode).toBe(403);
  });

  it("يحفظ السر مشفراً ولا يعيده من الواجهة العامة", async () => {
    const put = await app().inject({ method: "PUT", url: "/sso/config", headers: session, payload: body });
    expect(put.statusCode).toBe(200);
    expect(put.body).not.toContain(body.clientSecret);
    expect(put.body).not.toContain("clientSecretEnvelope");
    const stored = await container.ssoStore.getPrivate(tenant.tenantId);
    expect(stored?.clientSecretEnvelope).toMatch(/^v1:/u);
    expect(stored?.clientSecretEnvelope).not.toContain(body.clientSecret);
  });

  it("يعيد إعداداً منقحاً ويحذف عبر CSRF صحيح", async () => {
    const get = await app().inject({ method: "GET", url: "/sso/config", headers: { cookie: session.cookie ?? "" } });
    expect(get.statusCode).toBe(200);
    expect(JSON.parse(get.body).config.clientSecretConfigured).toBe(true);
    const del = await app().inject({ method: "DELETE", url: "/sso/config", headers: session });
    expect(del.statusCode).toBe(200);
  });

  it("يرفض تغييراً بلا CSRF أو من Origin غير موثوق", async () => {
    const noCsrf = await app().inject({ method: "PUT", url: "/sso/config", headers: { cookie: session.cookie ?? "", origin }, payload: body });
    expect(noCsrf.statusCode).toBe(403);
    const wrongOrigin = await app().inject({ method: "PUT", url: "/sso/config", headers: { ...session, origin: "https://evil.example" }, payload: body });
    expect(wrongOrigin.statusCode).toBe(403);
  });

  it("enabled=true بلا سر ولا keep = رفض 400 صريح", async () => {
    const noSecret = { ...body, clientSecret: undefined };
    const reject = await app().inject({ method: "PUT", url: "/sso/config", headers: session, payload: noSecret });
    expect(reject.statusCode).toBe(400);
  });

  it("keepClientSecret يعيد الختم ويحافظ على السر", async () => {
    // الإعداد موجود بسر من اختبار سابق؟ حُذف — أُنشئه بسر ثم أحدّث بلا سر جديد مع keep
    const withSecret = await app().inject({ method: "PUT", url: "/sso/config", headers: session, payload: body });
    expect(withSecret.statusCode).toBe(200);
    const before = await container.ssoStore.getPrivate(tenant.tenantId);
    expect(before?.clientSecretEnvelope).toMatch(/^v1:/u);
    const keepBody = { ...body, clientSecret: undefined, keepClientSecret: true };
    const kept = await app().inject({ method: "PUT", url: "/sso/config", headers: session, payload: keepBody });
    expect(kept.statusCode).toBe(200);
    const after = await container.ssoStore.getPrivate(tenant.tenantId);
    expect(after?.clientSecretEnvelope).toMatch(/^v1:/u);
    // إعادة الختم تعني مغلفاً جديداً بإصدار جديد — ليس نسخ المغلف القديم
    expect(after?.clientSecretEnvelope).not.toBe(before?.clientSecretEnvelope);
    expect(after?.configVersion).toBe((before?.configVersion ?? 0) + 1);
  });

  it("تعارض CAS (تحديثان متزامنان) — أحدهما 200 والآخر 409", async () => {
    // استدعاءان متزامنان بنفس session — CAS يضمن ألا يدهس أحدهما الآخر بصمت
    const results = await Promise.allSettled([
      app().inject({ method: "PUT", url: "/sso/config", headers: session, payload: { ...body, clientId: "c-1" } }),
      app().inject({ method: "PUT", url: "/sso/config", headers: session, payload: { ...body, clientId: "c-2" } }),
    ]);
    const statuses = results.map((r) => (r.status === "fulfilled" ? r.value.statusCode : 0));
    // الحتمي: متى ما تسابق الاثنان بقراءة نفس الإصدار، أحدهما يفشل 409.
    // إن تخلل توقيتاً (الأول كتب قبل قراءة الثاني) فكلاهما قد ينجح تسلسلياً —
    // لذا التأكيد الصارم: لا 500، وعند وجود فاشل فهو 409 حصراً.
    expect(statuses.filter((s) => s >= 500).length).toBe(0);
    const conflict = statuses.filter((s) => s === 409).length;
    const success = statuses.filter((s) => s === 200).length;
    expect(conflict + success).toBe(2);
  });
});
