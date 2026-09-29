/**
 * اختبارات جسر API-key — الجسر لا يوسّع صلاحيات الاعتماد إلى عضوية:
 * جلسة الجسر تحمل صلاحيات الاعتماد حصراً، المستخدم المميز لا يرث sso:manage
 * من جسره، وإلغاء الاعتماد يلغي جلساته المشتقة ذرياً.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import { seedTenant } from "./test-helpers.js";
import { hashApiKey } from "@agentbridge/infra";

const origin = "http://127.0.0.1:3001";

function bridgeSessionHeaders(setCookie: string | string[] | undefined): Record<string, string> {
  const values = Array.isArray(setCookie) ? setCookie : setCookie === undefined ? [] : [setCookie];
  const cookies = values.map((value) => value.split(";", 1)[0] ?? "").filter(Boolean);
  const csrf = cookies.find((value) => value.startsWith("ab_csrf="))?.slice("ab_csrf=".length) ?? "";
  return { cookie: cookies.join("; "), origin, "x-csrf-token": decodeURIComponent(csrf) };
}

describe("جسر API-key بلا توسيع صلاحيات", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  let tenant: Awaited<ReturnType<typeof seedTenant>>;
  let workRoot: string;
  let session: Record<string, string>;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "ab-bridge-"));
    container = await buildContainer({ env: developmentEnv(), workRoot });
    app = buildApp(container);
    // مستأجر عضويته tenant_admin واعتماده سيُضيَّق لاحقاً إلى صلاحية واحدة —
    // هذا بالضبط السيناريو الذي كان يوسّع الصلاحيات في الكود القديم
    tenant = await seedTenant(container, "bridge-tenant", "جسر", true);
    await container.authStore.putApiCredential({
      credentialId: `legacy:${tenant.tenantId}`, tenantId: tenant.tenantId,
      subjectId: `service:${tenant.tenantId}`,
      // نفس hash المفتاح الخام المبذور — تضييق الصلاحيات فقط لا المفتاح
      keyHash: hashApiKey(tenant.apiKey),
      permissions: ["resource:read"], authorizationVersion: 1,
    });
    const login = await app.inject({ method: "POST", url: "/auth/api-key/session", headers: { origin }, payload: { tenantId: tenant.tenantId, apiKey: tenant.apiKey } });
    expect(login.statusCode).toBe(200);
    session = bridgeSessionHeaders(login.headers["set-cookie"]);
    // اعتماد ثانٍ يحمل صراحة sso:manage وtenant:admin — التقاطع
    // يجب أن يحجبهما (العضوية tenant_admin أيضاً لا تنقذهما من الحجب)
    await container.authStore.putApiCredential({
      credentialId: `admin-cred:${tenant.tenantId}`, tenantId: tenant.tenantId,
      subjectId: `service:${tenant.tenantId}`,
      keyHash: hashApiKey(tenant.apiKey),
      permissions: ["resource:read", "sso:manage", "tenant:admin"], authorizationVersion: 1,
    });
  });

  afterAll(async () => { await app.close(); rmSync(workRoot, { recursive: true, force: true }); });

  it("جلسة الجسر تحمل صلاحيات الاعتماد حصراً — العضوية المميزة لا تُسرّب شيئاً", async () => {
    const status = await app.inject({ method: "GET", url: "/auth/session", headers: session });
    expect(status.statusCode).toBe(200);
    const { permissions } = JSON.parse(status.body) as { permissions: string[] };
    // الاعتماد ضيق (resource:read) والعضوية tenant_admin — الجلسة = الاعتماد حصراً:
    // لا sso:manage ولا tenant:admin من العضوية، ولا pipeline:run من دور الاعتماد القديم
    expect(permissions).toEqual(["resource:read"]);
  });

  it("المستخدم العادي عبر OIDC يبقى بصلاحيات دوره لا صلاحيات اعتماد", async () => {
    // متحقق عبر عقد SessionService مباشرة: مسار OIDC بلا sessionPermissions
    const { SessionService } = await import("./auth/session-service.js");
    const service = new SessionService(container.authStore);
    const issued = await service.issue("identity-x", { membershipId: "m1", identityId: "identity-x", tenantId: "bridge-tenant", role: "reader", status: "active", authorizationVersion: 1 }, "binding", "oidc");
    expect(issued.record.permissions).toEqual(["resource:read", "artifact:read", "flywheel:read", "analytics:read"]);
  });

  it("اعتماد يحمل sso:manage وtenant:admin صراحة — الجلسة لا تحصل عليهما", async () => {
    // جلسة جسر ثانية من الاعتماد المميز (نفس المفتاح) — التقاطع يحجب الإداريتين
    const login = await app.inject({ method: "POST", url: "/auth/api-key/session", headers: { origin }, payload: { tenantId: tenant.tenantId, apiKey: tenant.apiKey } });
    expect(login.statusCode).toBe(200);
    const adminSession = bridgeSessionHeaders(login.headers["set-cookie"]);
    const status = await app.inject({ method: "GET", url: "/auth/session", headers: adminSession });
    expect(status.statusCode).toBe(200);
    const { permissions } = JSON.parse(status.body) as { permissions: string[] };
    // الاعتماد حمل sso:manage وtenant:admin صراحة — التقاطع الثلاثي (اعتماد ∩
    // allowlist ∩ عضوية) يمنع الجسر من منحهما إطلاقاً
    expect(permissions).not.toContain("sso:manage");
    expect(permissions).not.toContain("tenant:admin");
    expect(permissions).toContain("resource:read");
  });

  it("جلسة الجسر المميزة تُرفض 403 على PUT/DELETE /sso/config", async () => {
    const login = await app.inject({ method: "POST", url: "/auth/api-key/session", headers: { origin }, payload: { tenantId: tenant.tenantId, apiKey: tenant.apiKey } });
    expect(login.statusCode).toBe(200);
    const adminSession = bridgeSessionHeaders(login.headers["set-cookie"]);
    const ssoBody = { provider: "oidc", issuer: "https://issuer.example.com", clientId: "client-x", jwksUrl: "https://issuer.example.com/jwks", authorizationEndpoint: "https://issuer.example.com/authorize", tokenEndpoint: "https://issuer.example.com/token", scopes: ["openid"], clientSecret: "secret-bridge-test", enabled: false };
    const put = await app.inject({ method: "PUT", url: "/sso/config", headers: adminSession, payload: ssoBody });
    expect(put.statusCode).toBe(403);
    const del = await app.inject({ method: "DELETE", url: "/sso/config", headers: adminSession });
    expect(del.statusCode).toBe(403);
  });

  it("إلغاء الاعتماد يلغي الجلسة المشتقة ذرياً — فشل الطلب التالي بـ401", async () => {
    await container.authStore.putApiCredential({
      credentialId: `legacy:${tenant.tenantId}`, tenantId: tenant.tenantId,
      subjectId: `service:${tenant.tenantId}`, keyHash: "x", permissions: ["resource:read"],
      authorizationVersion: 1, revokedAt: new Date().toISOString(),
    });
    const after = await app.inject({ method: "GET", url: "/auth/session", headers: session });
    expect(after.statusCode).toBe(401);
  });

  it("الجسر يرفض طلباً بلا Origin مطابق", async () => {
    const noOrigin = await app.inject({ method: "POST", url: "/auth/api-key/session", payload: { tenantId: tenant.tenantId, apiKey: tenant.apiKey } });
    expect(noOrigin.statusCode).toBe(403);
  });
});
