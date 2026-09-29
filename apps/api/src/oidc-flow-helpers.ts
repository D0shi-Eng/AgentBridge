/**
 * عدة اختبار OIDC المساري — حاوية حية بالدور المقيد + IdP محلي
 * آمن: شبكة JWKS معترضة (السياسة والتوقيع فعليان) وموقّع RS256 محلي،
 * ومبادل code معدود النداءات. لا اتصال خارجي إطلاقاً.
 */
import { generateKeyPairSync } from "node:crypto";
import { Writable } from "node:stream";
import { buildLoggerOptions, signOidcToken, generateEncryptionKeyBase64 } from "@agentbridge/infra";
import { mockJwks } from "./plugins/sso-test-network.js";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv } from "./container.js";
import type { ApiContainer } from "./container.js";
import type { OidcCodeExchange } from "@agentbridge/infra";
import { cookiePolicy } from "./auth/cookies.js";
import { dropEphemeralDatabase, ownerPrisma, provisionRestrictedRole } from "../../../tests/e2e/rls-live-harness.js";
import { createMigratedDb } from "../../../tests/e2e/upgrade-harness.js";

export const TENANT = "t-oidc";
export const ORIGIN = "http://127.0.0.1:3001";
export const ISSUER = "https://issuer.example.com";

export interface FlowFixture {
  container: ApiContainer;
  app: ReturnType<typeof buildApp>;
  database: string;
  adminUrl: string;
  logs: () => string;
  exchangerCalls: () => number;
  resetExchanger: () => void;
  setSubject: (sub: string) => void;
  signToken: (sub: string, nonce: string) => string;
  nonceOfLatestTx: () => Promise<string>;
  refreshJwks: () => void;
  clearTransactions: () => Promise<void>;
}

/** يقوم بالتركيب الحي الكامل — يُستدعى في beforeAll واحد */
export async function setupOidcFlow(exchangerImpl?: (input: OidcCodeExchange) => Promise<string>): Promise<FlowFixture> {
  const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = { ...pair.publicKey.export({ format: "jwk" }), kid: "test-kid", alg: "RS256" };
  const privateJwk = pair.privateKey.export({ format: "jwk" }) as Record<string, unknown>;
  const captured: string[] = [];
  const logStream = new Writable({
    write(chunk, _encoding, callback) { captured.push(chunk.toString("utf8")); callback(); },
  });
  // مكتملة الهجرات + مالك منفصل غير خارق — مطابقة لوضع الإنتاج كي يمر فحص الإقلاع
  const { database, adminUrl } = await createMigratedDb();
  const restrictedUrl = await provisionRestrictedRole(adminUrl, database);
  const owner = ownerPrisma(adminUrl);
  await owner.$executeRawUnsafe(`INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ($1,'OIDC','h',false,NOW())`, TENANT);
  await owner.$executeRawUnsafe(`INSERT INTO "tenants" ("id","name","api_key_hash","is_admin","created_at") VALUES ('t-foreign','أخرى','h',false,NOW())`);
  await owner.$executeRawUnsafe(
    `INSERT INTO "external_identities" ("id","issuer","subject","created_at") VALUES ('i-oidc-user',$1,'oidc-user',NOW())`, ISSUER);
  await owner.$executeRawUnsafe(
    `INSERT INTO "external_identities" ("id","issuer","subject","created_at") VALUES ('i-foreign',$1,'foreign-user',NOW())`, ISSUER);
  await owner.$executeRawUnsafe(
    `INSERT INTO "memberships" ("id","identity_id","tenant_id","role","status","authorization_version") VALUES ('m-oidc-user','i-oidc-user',$1,'reader','active',1)`, TENANT);
  // هوية عابرة: عضويتها في مستأجر آخر حصراً — تختبر ربط المعاملة بالمستأجر
  await owner.$executeRawUnsafe(
    `INSERT INTO "memberships" ("id","identity_id","tenant_id","role","status","authorization_version") VALUES ('m-foreign','i-foreign','t-foreign','reader','active',1)`);
  await owner.$disconnect();
  let exchangerCount = 0;
  let tokenSubject = "oidc-user";
  const container = await buildContainer({
    env: { ...developmentEnv(), PERSISTENCE: "live", DATABASE_URL: restrictedUrl, REDIS_URL: process.env.AB_LIVE_REDIS_URL ?? "redis://localhost:6380", ENCRYPTION_KEY: generateEncryptionKeyBase64() },
    oidcExchanger: exchangerImpl ?? (async (input) => {
      exchangerCount += 1;
      const nonce = await latestNonce(adminUrl, TENANT);
      return signOidcToken({ iss: ISSUER, aud: input.clientId, sub: tokenSubject, exp: Math.floor(Date.now() / 1000) + 300, nonce }, privateJwk, "test-kid");
    }),
  });
  // خيارات الإنتاج المرقطة نفسها + مجرى الالتقاط — لا تجاوز للـredact
  const app = buildApp(container, { ...buildLoggerOptions("debug"), stream: logStream });
  mockJwks({ keys: [publicJwk] });
  return {
    container, app, database,
    logs: () => captured.join(""),
    exchangerCalls: () => exchangerCount,
    resetExchanger: () => { exchangerCount = 0; },
    setSubject: (sub: string) => { tokenSubject = sub; },
    signToken: (sub, nonce) => signOidcToken({ iss: ISSUER, aud: "client-123", sub, exp: Math.floor(Date.now() / 1000) + 300, nonce }, privateJwk, "test-kid"),
    nonceOfLatestTx: () => latestUnconsumedNonce(adminUrl, TENANT),
    refreshJwks: () => mockJwks({ keys: [publicJwk] }),
    adminUrl,
    clearTransactions: async () => {
      const client = ownerClient(adminUrl);
      await client.$executeRawUnsafe(`DELETE FROM "login_transactions" WHERE "tenant_id"=$1`, TENANT);
      await client.$disconnect();
    },
  };
}

function ownerClient(adminUrl: string) {
  return ownerPrisma(adminUrl);
}

/** nonce أحدث معاملة حية (بعد start وقبل callback) — لإثبات حالة 1 */
async function latestUnconsumedNonce(adminUrl: string, tenant: string): Promise<string> {
  const client = ownerClient(adminUrl);
  const rows = await client.$queryRawUnsafe<Array<{ nonce: string }>>(
    `SELECT nonce FROM "login_transactions" WHERE "tenant_id"=$1 AND "consumed_at" IS NULL LIMIT 1`, tenant);
  await client.$disconnect();
  if (rows[0] === undefined) throw new Error("لا معاملة حية");
  return rows[0].nonce;
}

async function latestNonce(adminUrl: string, tenant: string): Promise<string> {
  // المسار يستحدث المعاملة قبل المبادل — الأحدث استهلاكاً هي معاملة النداء نفسها
  const client = ownerClient(adminUrl);
  const rows = await client.$queryRawUnsafe<Array<{ nonce: string }>>(
    `SELECT nonce FROM "login_transactions" WHERE "tenant_id"=$1 AND "consumed_at" IS NOT NULL
      ORDER BY "consumed_at" DESC LIMIT 1`, tenant);
  await client.$disconnect();
  if (rows[0] === undefined) throw new Error("لا معاملة مستهلكة بعد");
  return rows[0].nonce;
}

/** start عبر API ويعيد state وcookie الربط وعنوان التصويب */
let callCounter = 0;

/** عنوان مصدر فريد لكل نداء — عزل عدادات preAuth بين نداءات الاختبار */
function uniqueRemoteAddress(): string {
  callCounter = (callCounter + 1) % 200;
  return `10.77.0.${20 + callCounter}`;
}

export async function doStart(app: ReturnType<typeof buildApp>, tenantId: string): Promise<{ state: string; cookie: string; authorizationUrl: string }> {
  const response = await app.inject({ method: "POST", url: "/auth/oidc/start", remoteAddress: uniqueRemoteAddress(), headers: { origin: ORIGIN }, payload: { tenantId, returnPath: "/app" } });
  if (response.statusCode !== 200) throw new Error(`start فشل: ${response.statusCode} ${response.body}`);
  const url = new URL((response.json() as { authorizationUrl: string }).authorizationUrl);
  const state = url.searchParams.get("state") ?? "";
  const cookie = response.cookies.map((entry) => `${entry.name}=${entry.value}`).join("; ");
  return { state, cookie, authorizationUrl: url.toString() };
}

/** شكل الرد اللازم للاختبار بنيوياً (statusCode + cookies) بلا تبعية مباشرة */
type InjectShape = { statusCode: number; cookies: Array<{ name: string; value: string }> };

/** callback عبر API — يعيد رمز الحالة والكوكيز الصادرة */
export async function doCallback(app: ReturnType<typeof buildApp>, state: string, cookie: string, code = "auth-code"): Promise<InjectShape> {
  return app.inject({ method: "GET", url: `/auth/oidc/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, remoteAddress: uniqueRemoteAddress(), headers: { cookie } });
}

export const flowPolicy = cookiePolicy;
export async function teardownOidcFlow(fixture: FlowFixture): Promise<void> {
  await fixture.app.close();
  await fixture.container.close?.();
  await dropEphemeralDatabase(fixture.database);
}
