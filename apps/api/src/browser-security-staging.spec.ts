/**
 * اختبارات STAGING_HTTPS — بيئة HTTPS التدريبية.
 *
 * الضوابط السلبية أولاً: بلا المفتاح، سلوك التطوير التاريخي حرفياً —
 * كوكيز dev بلا Secure وبلا HSTS. مع المفتاح، شكل الإنتاج كاملاً فوق
 * بيئة تطوير: __Host- + Secure + HttpOnly + SameSite=Lax + HSTS.
 * بهذا يثبت أن المفتاح يُشدّد الأمن فقط ولا يمكنه تخفيفه.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import { cookiePolicy } from "./auth/cookies.js";

function stagingEnv(): Record<string, string> {
  return { ...developmentEnv(), STAGING_HTTPS: "1" };
}

describe("cookiePolicy (نقية)", () => {
  it("التطوير الافتراضي: أسماء dev وغير آمنة — سلوك تاريخي بلا مساس", () => {
    expect(cookiePolicy("development")).toEqual({
      sessionName: "ab_session_dev", loginName: "ab_login_dev", secure: false,
    });
  });

  it("الإنتاج يبقى كما هو بلا المفتاح وبمفتاحه — أشدّ أصلاً", () => {
    expect(cookiePolicy("production")).toEqual(cookiePolicy("production", true));
    expect(cookiePolicy("production").sessionName).toBe("__Host-ab_session");
    expect(cookiePolicy("production").secure).toBe(true);
  });

  it("STAGING_HTTPS يفرض شكل الإنتاج فوق بيئة تطوير", () => {
    expect(cookiePolicy("development", true)).toEqual({
      sessionName: "__Host-ab_session", loginName: "__Host-ab_login", secure: true,
    });
  });
});

describe("STAGING_HTTPS فوق التطبيق الحي", () => {
  let container: ApiContainer;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    container = await buildContainer({ env: stagingEnv() });
    app = buildApp(container);
  });

  afterAll(async () => {
    await app.close();
    await container.close?.();
  });

  it("ترويسات الحدود تحمل HSTS في وضع staging-HTTPS", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["strict-transport-security"]).toContain("max-age=31536000");
  });

  it("جسر الدخول يصدر كوكيز شكل الإنتاج: __Host- + Secure + HttpOnly + SameSite=Lax", async () => {
    // مستأجر مؤقت لهذا الاختبار — المفتاح الخام عرضٌ واحد في الذاكرة
    const { generateApiKey, hashApiKey } = await import("@agentbridge/infra");
    const apiKey = generateApiKey();
    await container.semantic.createTenant({
      tenantId: "stg-tenant", name: "staging", apiKeyHash: hashApiKey(apiKey), createdAt: new Date().toISOString(),
    });
    await container.authStore.putApiCredential({
      credentialId: "legacy:stg-tenant", tenantId: "stg-tenant", subjectId: "service:stg-tenant",
      keyHash: hashApiKey(apiKey), permissions: ["resource:read"], authorizationVersion: 1,
    });
    await container.authStore.putExternalIdentity({
      identityId: "identity:stg-tenant", issuer: "urn:agentbridge:legacy-api-key",
      subject: "service:stg-tenant", createdAt: new Date().toISOString(),
    });
    await container.authStore.putMembership({
      membershipId: "membership:stg-tenant", identityId: "identity:stg-tenant",
      tenantId: "stg-tenant", role: "reviewer", status: "active", authorizationVersion: 1,
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/api-key/session",
      headers: { "content-type": "application/json", origin: container.config.appOrigin },
      payload: { tenantId: "stg-tenant", apiKey },
    });
    expect(response.statusCode).toBe(200);
    const cookies = response.headers["set-cookie"] as unknown as string[];
    const sessionCookie = cookies.find((cookie) => cookie.startsWith("__Host-ab_session="));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("Secure");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).toContain("Path=/");
    expect(sessionCookie).not.toContain("Domain=");
  });
});

describe("الضابط السلبي: بلا STAGING_HTTPS لا HSTS ولا كوكيز آمنة (تطوير)", () => {
  let container: ApiContainer;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    container = await buildContainer({ env: developmentEnv() });
    app = buildApp(container);
  });

  afterAll(async () => {
    await app.close();
    await container.close?.();
  });

  it("تطوير عادي: بلا HSTS واسم الكوكي dev كما هو", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    // مصدر الحقيقة الثاني: سياسة الكوكيز من نفس الإعدادات
    expect(cookiePolicy("development", false).secure).toBe(false);
  });
});
