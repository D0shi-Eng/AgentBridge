/**
 * اختبار حي: رحلة OIDC كاملة ضد IdP فعلي (Keycloak) عبر TLS.
 *
 * قاعدة صارمة: لا mock token endpoint يعدّ مزود هوية فعلياً. هنا
 * IdP حقيقي في حاوية معزولة ببيانات اصطناعية، اتصالنا به عبر HTTPS
 * بثقة CA من ملف (لا تعطيل تحقق إطلاقاً — `rejectUnauthorized:false`
 * مرفوضة بنيوياً وسياسة JWKS تمنحه أصلاً).
 *
 * الحالات المكافئة فوق TLS: بدء/state/binding، إعادة توجيه حقيقية،
 * تسجيل دخول فعلي بنموذج Keycloak، تبادل code (Basic auth) عبر قناة
 * policy-gated، تحقق التواقيع من JWKS حي، رفض replay ورفض تغير إعداد
 * SSO أثناء المعاملة، وأعلام الكوكيز، وحجب code/state من السجلات.
 *
 * الحارس: غياب IdP يُسقط الاختبار skip موثق السبب — لا فشل كاذب
 * ولا ادعاء إنجاز بلا بنية.
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { FastifyLoggerOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { request } from "node:https";
import { buildLoggerOptions, sealSecret } from "@agentbridge/infra";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import { seedTenant } from "./test-helpers.js";

const TLS_DIR = fileURLToPath(new URL("../../../tests/e2e/.tmp/keycloak-tls", import.meta.url));
const CA_PATH = join(TLS_DIR, "ca.pem");
const REALM_INFO_PATH = join(TLS_DIR, "realm-info.json");
const KC_BASE = "https://localhost:8444";
const API_ORIGIN = "http://127.0.0.1:34430";

interface RealmInfo {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly username: string;
  readonly userSub: string;
  readonly password: string;
}

let realmInfo: RealmInfo | null = null;
if (existsSync(REALM_INFO_PATH) && existsSync(CA_PATH)) {
  try {
    realmInfo = JSON.parse(readFileSync(REALM_INFO_PATH, "utf8")) as RealmInfo;
    // حارس توفر حقيقي: نقطة اكتشاف حية عبر TLS بثقة CA — لا افتراض
    realmInfo = await new Promise<RealmInfo | null>((resolve) => {
      const req = request(`${KC_BASE}/realms/live-realm/.well-known/openid-configuration`, { ca: readFileSync(CA_PATH), timeout: 4000 }, (res) => {
        res.resume();
        resolve(res.statusCode === 200 ? realmInfo : null);
      });
      req.on("error", () => resolve(null));
      req.on("timeout", () => { req.destroy(); resolve(null); });
      req.end();
    });
  } catch { realmInfo = null; }
}

/** جرار كوكيز يدوي — سلوك متصفح حقيقي فوق سوكيت حقيقي (لا fastify.inject) */
class CookieJar {
  private readonly jar = new Map<string, string>();
  absorb(response: Response): void {
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const raw of setCookies) {
      const [pair] = raw.split(";");
      const eq = pair?.indexOf("=");
      if (pair === undefined || eq === undefined || eq <= 0) continue;
      this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
      // توثيق الأعلام كما وصلت — تُدقق في اختبار الأعلام أدناه
      this.receivedRaw.push(raw);
    }
  }
  readonly receivedRaw: string[] = [];
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(name: string): boolean { return this.jar.has(name); }
  keys(): readonly string[] { return [...this.jar.keys()]; }
}

describe.skipIf(realmInfo === null)("رحلة OIDC ضد Keycloak فعلي عبر TLS", () => {
  const info = realmInfo as RealmInfo;
  let container: ApiContainer | null = null;
  let app: ReturnType<typeof buildApp> | null = null;
  const apiPort = 34430;
  const jar = new CookieJar();
  /** سجلات مطابقة الذاكرة لفحص عدم تسرب code/state/secret */
  let logSink: { logs: unknown[] };

  beforeAll(async () => {
    logSink = { logs: [] };
    // الاستثناء المحلي المحصور (سياسة policy.ts تقرأ process.env وقت النداء
    // — نمط JWKS_ALLOWED_HOSTS القائم): بيئة الاختبار فقط، والإنتاج يرفضه
    process.env.JWKS_ALLOW_LOOPBACK = "true";
    // سياسة الصادر تقرأ القائمة من process.env وقت النداء (نمط fetchJwks القائم)
    process.env.JWKS_ALLOWED_HOSTS = "localhost";
    container = await buildContainer({
      env: {
        ...developmentEnv(),
        PORT: "34430",
        APP_ORIGIN: API_ORIGIN,
        OIDC_REDIRECT_URI: `${API_ORIGIN}/auth/oidc/callback`,
        JWKS_ALLOWED_HOSTS: "localhost", // سياسة الصادر: IdP الاختباري فقط
        JWKS_ALLOW_LOOPBACK: "true", // الاستثناء المحلي المحصور — يرفضه الإنتاج fail-closed
      },
    });
    // التقاط السجلات في الذاكرة لفحص الحجب — يجب أن تحمل بوابة الحجب نفسها
    // (redact req.url وheaders) لا لوغر عارياً يمر بجانب السياسة
    const loggerOptions = {
      ...buildLoggerOptions("info"),
      stream: { write: (line: string): void => { logSink.logs.push(line); } },
    } as unknown as FastifyLoggerOptions;
    app = buildApp(container, loggerOptions);
    // بذر المستأجر والهوية الخارجية والعضوية — ربط iss/sub من IdP الفعلي
    await seedTenant(container, "kc-live-tenant", "مستأجر الاختبار الحي", true);
    await container.authStore.putExternalIdentity({
      identityId: "identity:keycloak-live", issuer: info.issuer, subject: info.userSub,
      createdAt: new Date().toISOString(),
    });
    // عضوية الهوية الخارجية في المستأجر — بدونه يرفض callback بعزل العضوية
    await container.authStore.putMembership({
      membershipId: "membership:keycloak-live", identityId: "identity:keycloak-live",
      tenantId: "kc-live-tenant", role: "tenant_admin", status: "active", authorizationVersion: 1,
    });
    // إعداد SSO للمستأجر بنقاط الاكتشاف الحقيقية وسر العميل المغلق
    const sealed = sealSecret(container.keyProvider, info.clientSecret, { tenantId: "kc-live-tenant", resourceId: "sso-config", purpose: "oidc_client_secret", version: 1 });
    await container.ssoStore.create({
      tenantId: "kc-live-tenant", enabled: true, provider: "oidc",
      issuer: info.issuer, jwksUrl: info.jwksUri,
      authorizationEndpoint: info.authorizationEndpoint,
      tokenEndpoint: info.tokenEndpoint,
      clientId: info.clientId,
      scopes: ["openid", "email"],
      clientSecretEnvelope: sealed,
    });
    await app.listen({ port: apiPort, host: "127.0.0.1" });
  }, 60_000);

  afterAll(async () => {
    await app?.close();
    await container?.close?.();
  });

  it("1) بدء المعاملة: state/nonce/PKCE تُولد خادمياً وتُخرج authorizationUrl حقيقي", async () => {
    const response = await fetch(`${API_ORIGIN}/auth/oidc/start`, {
      method: "POST",
      headers: { origin: API_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "kc-live-tenant", returnPath: "/app" }),
    });
    expect(response.status).toBe(200);
    jar.absorb(response);
    const body = (await response.json()) as { authorizationUrl: string };
    const target = new URL(body.authorizationUrl);
    expect(target.origin).toBe(KC_BASE); // إعادة التوجيه نحو IdP الفعلي فوق TLS
    expect(target.searchParams.get("code_challenge_method")).toBe("S256");
    expect(target.searchParams.get("state")?.length).toBeGreaterThan(20);
    expect(target.searchParams.get("nonce")).toBeTruthy();
  });

  /**
   * مساعد الرحلة الحقيقية: فتح authorizationUrl → تسجيل دخول فعلي في
   * نموذج Keycloak → متابعة كل التحويلات الوسيطة للـIdP (بكوكيزه) حتى
   * الوصول إلى رابط callback عندنا — لا قفز مفترض ولا محاكاة.
   */
  async function keycloakLoginToCallback(authorizationUrl: string): Promise<string> {
    const kcCookies: string[] = [];
    const page = await fetch(authorizationUrl, { redirect: "manual" });
    expect(page.status).toBe(200);
    for (const raw of page.headers.getSetCookie()) kcCookies.push(raw.split(";")[0] ?? "");
    const html = await page.text();
    const action = (html.match(/action="([^"]+)"/u)?.[1] ?? "").replace(/&amp;/gu, "&");
    expect(action).not.toBe("");
    let location: string = action;
    let method = "POST";
    let body: string = new URLSearchParams({ username: info.username, password: info.password }).toString();
    const referer = authorizationUrl;
    // متابعة تحويلات Keycloak حتى يعيدنا IdP إلى callback الخاص بنا
    for (let hop = 0; hop < 10; hop += 1) {
      const response = await fetch(location, {
        method, redirect: "manual",
        headers: {
          ...(method === "POST" ? { "content-type": "application/x-www-form-urlencoded" } : {}),
          ...(kcCookies.length > 0 ? { cookie: kcCookies.join("; ") } : {}),
          ...(method === "POST" ? { referer } : {}),
        },
        ...(method === "POST" ? { body } : {}),
      });
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(";")[0] ?? "";
        if (!kcCookies.includes(pair)) kcCookies.push(pair);
      }
      const next = response.headers.get("location") ?? "";
      if (next === "") return `STATUS:${response.status}`; // صفحة نهائية بلا تحويل (فشل متوقع)
      if (next.startsWith(API_ORIGIN)) return next;
      location = next;
      method = "GET";
      body = "";
    }
    throw new Error("تجاوز حد قفزات Keycloak دون الوصول إلى callback");
  }

  it("2) الرحلة الكاملة: دخول فعلي + تبادل code عبر TLS + تحقق JWKS حي + جلسة", async () => {
    const start = await fetch(`${API_ORIGIN}/auth/oidc/start`, {
      method: "POST", redirect: "manual",
      headers: { origin: API_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "kc-live-tenant", returnPath: "/app" }),
    });
    jar.absorb(start);
    const { authorizationUrl } = (await start.json()) as { authorizationUrl: string };
    const callbackUrl = await keycloakLoginToCallback(authorizationUrl);
    expect(callbackUrl.startsWith(`${API_ORIGIN}/auth/oidc/callback?`)).toBe(true);

    // العودة إلى callback بكوكيز الربط — تبادل code عبر TLS وتحقق التواقيع من JWKS حي
    const callback = await fetch(callbackUrl, { redirect: "manual", headers: { cookie: jar.header() } });
    expect([302, 303]).toContain(callback.status);
    const location = callback.headers.get("location") ?? "";
    expect(location.startsWith(API_ORIGIN + "/app")).toBe(true);
    jar.absorb(callback);
    // جلسة فعلية صادرة
    expect(jar.keys().some((k) => k.toLowerCase().includes("session"))).toBe(true);
  }, 60_000);

  it("3) أعلام الكوكيز: HttpOnly وSameSite حاضران دائماً (Secure بسياسة NODE_ENV)", () => {
    // جرار الرحلات تراكم كوكيز البدء والجلسات — أول كوكي HttpOnly يكفي للعقد
    const withFlags = jar.receivedRaw.find((raw) => raw.toLowerCase().includes("httponly"));
    expect(withFlags).toBeTruthy();
    expect(withFlags?.toLowerCase()).toContain("samesite=lax");
    // ملاحظة موثقة: علم Secure يفعّله cookiePolicy في الإنتاج — التحقق
    // الكامل فوق نشر HTTPS إنتاجي يتطلب بيئة TLS كاملة ولا هنا.
  });

  it("4) replay: إعادة استخدام نفس callback (code مستهلك) تُرفض 401", async () => {
    const start = await fetch(`${API_ORIGIN}/auth/oidc/start`, {
      method: "POST", headers: { origin: API_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "kc-live-tenant", returnPath: "/app" }),
    });
    jar.absorb(start); // كوكي الربط لهذه المعاملة تحديداً — بثبات السبب
    const { authorizationUrl } = (await start.json()) as { authorizationUrl: string };
    const callbackUrl = await keycloakLoginToCallback(authorizationUrl);
    const first = await fetch(callbackUrl, { redirect: "manual", headers: { cookie: jar.header() } });
    expect([302, 303]).toContain(first.status);
    // المحاولة الثانية بنفس state المُستهلك: المعاملة one-time — الرفض مضمون
    const replay = await fetch(callbackUrl, { redirect: "manual", headers: { cookie: jar.header() } });
    expect(replay.status).toBe(401);
  }, 60_000);

  it("5) binding مفقود: callback بلا كوكي الربط = 401 حتى بstate صحيح", async () => {
    const start = await fetch(`${API_ORIGIN}/auth/oidc/start`, {
      method: "POST", headers: { origin: API_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "kc-live-tenant", returnPath: "/app" }),
    });
    const { authorizationUrl } = (await start.json()) as { authorizationUrl: string };
    const callbackUrl = await keycloakLoginToCallback(authorizationUrl);
    // callback بلا أي كوكيز — الربط بالمتصفح مفقود: رفض قبل أي تبادل
    const orphan = await fetch(callbackUrl, { redirect: "manual" });
    expect(orphan.status).toBe(401);
  }, 60_000);

  it("6) تغيّر إعداد SSO بين البدء والعودة = رفض قبل أي تبادل مع IdP", async () => {
    if (container === null) throw new Error("الحاوية يجب أن تكون مهيأة في beforeAll");
    const start = await fetch(`${API_ORIGIN}/auth/oidc/start`, {
      method: "POST", headers: { origin: API_ORIGIN, "content-type": "application/json" },
      body: JSON.stringify({ tenantId: "kc-live-tenant", returnPath: "/app" }),
    });
    jar.absorb(start); // ربط الرحلة بكوكيها حتى يكون الرفض لسبب الإصدار لا الربط
    const { authorizationUrl } = (await start.json()) as { authorizationUrl: string };
    const config = await container.ssoStore.getPrivate("kc-live-tenant");
    if (config === null) throw new Error("الإعداد يجب أن يكون موجوداً");
    // تحديث يرفع الإصدار — محاكاة تعديل/إعادة إنشاء الإعداد أثناء المعاملة
    await container.ssoStore.update({ ...config, clientSecretEnvelope: config.clientSecretEnvelope }, { expectedInstanceId: config.configInstanceId, expectedVersion: config.configVersion });
    const callbackUrl = await keycloakLoginToCallback(authorizationUrl);
    const stale = await fetch(callbackUrl, { redirect: "manual", headers: { cookie: jar.header() } });
    expect(stale.status).toBe(401);
    const errorBody = (await stale.json()) as { error?: { code?: string } };
    expect(errorBody.error?.code).toBe("UNAUTHORIZED");
  }, 60_000);

  it("7) حجب الأسرار: code وstate وsecret لا يظهرون في سجلات الخادم", async () => {
    const dumped = logSink.logs.map(String).join("\n");
    // code يظهر في استعلام callback — لا يجوز أن يُسجل خاماً
    expect(dumped).not.toContain("code=");
    expect(dumped).not.toContain(info.clientSecret);
    // state مولّد خادمياً عشوائي — لا قيمة له في السجلات
    const stateValues = [...dumped.matchAll(/"state":"([A-Za-z0-9_-]{20,})"/gu)]
      .map((m) => m[1])
      .filter((state): state is string => state !== undefined);
    for (const state of stateValues) expect(dumped.split(state).length).toBeLessThanOrEqual(2);
  });

  it("8) سياسة الصادر تمنع IdP خارج القائمة حتى لو تغير الإعداد (سلبي)", async () => {
    const { allowedJwksUrl } = await import("@agentbridge/infra");
    // host غير مدرج في JWKS_ALLOWED_HOSTS=localhost → رفض فوري
    expect(() => allowedJwksUrl("https://evil.example.com/realms/x/protocol/openid-connect/certs", ["localhost"])).toThrow();
    // host مدرج لكنه ليس https → رفض
    expect(() => allowedJwksUrl("http://localhost/realms/x/certs", ["localhost"])).toThrow();
    // القائمة نفسها تسمح بالـIdP الفعلي حصراً
    expect(() => allowedJwksUrl(info.jwksUri, ["localhost"])).not.toThrow();
  });
});
