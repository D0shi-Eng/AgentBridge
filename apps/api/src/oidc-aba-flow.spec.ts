/**
 * الرحلة الكاملة من API فوق البنية الحية بالدور المقيد:
 * ABA (401 قبل المبادل بالعدّ)، replay، عرقلة مستأجر وعضوية، تزامن، وأسرار.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sealSecret, type SsoConfigWriteInput } from "@agentbridge/infra";
import {
  doCallback, doStart, setupOidcFlow, teardownOidcFlow, TENANT, type FlowFixture,
} from "./oidc-flow-helpers.js";
import { setupJwksNetwork } from "./plugins/sso-test-network.js";
import { ownerPrisma } from "../../../tests/e2e/rls-live-harness.js";

// تسجيل اعتراض الشبكة على مستوى الوحدة — قبل beforeEach التحديث كي يسبح أولاً (FIFO)
setupJwksNetwork();
import { liveUp } from "../../../tests/e2e/upgrade-harness.js";

const baseInput: SsoConfigWriteInput = {
  tenantId: TENANT, provider: "oidc", issuer: "https://issuer.example.com", clientId: "client-123",
  jwksUrl: "https://issuer.example.com/jwks", authorizationEndpoint: "https://issuer.example.com/authorize",
  tokenEndpoint: "https://issuer.example.com/token", scopes: ["openid"], enabled: true,
};
const RAW_SECRET = "secret-value-raw";

let fixture: FlowFixture;
let stored: { instanceId: string; version: number };

beforeAll(async () => {
  if (!liveUp) return;
  fixture = await setupOidcFlow();
  // المغلف حقيقي: مختم بمفتاح الحاوية نفسه (بأصدار 1) — المبادل سيفكه فعلاً
  const created = await fixture.container.ssoStore.create({
    ...baseInput,
    clientSecretEnvelope: sealSecret(fixture.container.keyProvider, RAW_SECRET, {
      tenantId: TENANT, resourceId: "sso-config", purpose: "oidc_client_secret", version: 1,
    }),
  });
  stored = { instanceId: created.configInstanceId, version: created.configVersion };
}, 240_000);

afterAll(async () => {
  if (fixture !== undefined) await teardownOidcFlow(fixture);
});

beforeEach(() => { if (fixture !== undefined) fixture.refreshJwks(); });

async function updateConfig(mutate: (input: SsoConfigWriteInput) => SsoConfigWriteInput): Promise<void> {
  const current = await fixture.container.ssoStore.getPrivate(TENANT);
  await fixture.container.ssoStore.update(mutate(baseInput), {
    expectedInstanceId: current?.configInstanceId ?? "", expectedVersion: current?.configVersion ?? 0,
  });
}

describe.skipIf(!liveUp)("OIDC من API فوق البنية الحية", () => {
  it("حالة 1: start يثبت state/nonce/PKCE S256/ربط المتصفح وهوية الدورة في القاعدة", { timeout: 60_000 }, async () => {
    const start = await doStart(fixture.app, TENANT);
    const url = new URL(start.authorizationUrl);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect((url.searchParams.get("code_challenge") ?? "").length).toBeGreaterThan(20);
    expect(url.searchParams.get("nonce")).toBeTruthy();
    expect(start.state.length).toBeGreaterThan(20);
    expect(start.cookie).toContain("ab_login_dev=");
    const row = await fixture.nonceOfLatestTx();
    expect(row.length).toBeGreaterThan(10);
    await fixture.clearTransactions();
  });

  it("حالة 2: start ثم تحديث الإعداد ثم callback القديم ⇒ 401 والمبادل صفر", { timeout: 60_000 }, async () => {
    const start = await doStart(fixture.app, TENANT);
    await updateConfig((input) => ({ ...input, clientId: "client-rotated" }));
    const callback = await doCallback(fixture.app, start.state, start.cookie);
    expect(callback.statusCode).toBe(401);
    expect(fixture.exchangerCalls()).toBe(0);
    await fixture.clearTransactions();
  });

  it("حالة 3: start ثم delete+recreate ثم callback القديم ⇒ 401 والمبادل صفر (إغلاق ABA)", { timeout: 60_000 }, async () => {
    const start = await doStart(fixture.app, TENANT);
    expect(await fixture.container.ssoStore.delete(TENANT)).toBe(true);
    const recreated = await fixture.container.ssoStore.create({ ...baseInput, clientId: "client-123" });
    expect(recreated.configInstanceId).not.toBe(stored.instanceId);
    stored = { instanceId: recreated.configInstanceId, version: recreated.configVersion };
    const callback = await doCallback(fixture.app, start.state, start.cookie);
    expect(callback.statusCode).toBe(401);
    expect(fixture.exchangerCalls()).toBe(0);
    await fixture.clearTransactions();
  });

  it("حالة 4: start جديد بعد recreate ⇒ callback صحيح ينجح بجلسة (303)", { timeout: 60_000 }, async () => {
    const start = await doStart(fixture.app, TENANT);
    fixture.resetExchanger();
    const callback = await doCallback(fixture.app, start.state, start.cookie);
    expect(callback.statusCode).toBe(303);
    expect(fixture.exchangerCalls()).toBe(1);
    const sessionCookie = callback.cookies.find((entry) => entry.name === "ab_session_dev");
    expect(sessionCookie).toBeDefined();
  });

  it("حالة 5: replay لنفس state ⇒ فشل (استهلاك one-time)", { timeout: 60_000 }, async () => {
    const start = await doStart(fixture.app, TENANT);
    expect((await doCallback(fixture.app, start.state, start.cookie)).statusCode).toBe(303);
    expect((await doCallback(fixture.app, start.state, start.cookie)).statusCode).toBe(401);
  });

  it("حالة 9: code وstate وnonce والسر الخام لا تظهر في السجلات الملتقطة", { timeout: 60_000 }, async () => {
    const logs = fixture.logs();
    expect(logs).not.toContain(RAW_SECRET);
    expect(logs).not.toContain(baseInput.clientSecretEnvelope ?? "###");
    expect(/state=[A-Za-z0-9_-]{20,}/u.test(logs)).toBe(false);
    expect(/code=[A-Za-z0-9_-]{20,}/u.test(logs)).toBe(false);
  });

  it("حالة 8: استهلاكان متزامنان لنفس state ⇒ نجاح واحد فقط", { timeout: 60_000 }, async () => {
    const start = await doStart(fixture.app, TENANT);
    fixture.resetExchanger();
    const results = await Promise.all([
      doCallback(fixture.app, start.state, start.cookie),
      doCallback(fixture.app, start.state, start.cookie),
    ]);
    expect(results.filter((r) => r.statusCode === 303)).toHaveLength(1);
    expect(results.filter((r) => r.statusCode === 401)).toHaveLength(1);
    expect(fixture.exchangerCalls()).toBe(1);
  });

  it("حالة 6: callback بهوية مستأجر مختلف (عضويته في t-foreign) ⇒ فشل", { timeout: 60_000 }, async () => {
    fixture.setSubject("foreign-user");
    try {
      const start = await doStart(fixture.app, TENANT);
      expect((await doCallback(fixture.app, start.state, start.cookie)).statusCode).toBe(401);
    } finally { fixture.setSubject("oidc-user"); }
  });

  it("حالة 7: callback بهوية عضويتها معطلة ⇒ فشل ثم يعود الحال فسينجح", { timeout: 60_000 }, async () => {
    await setMembershipStatus(fixture, "disabled");
    try {
      const start = await doStart(fixture.app, TENANT);
      expect((await doCallback(fixture.app, start.state, start.cookie)).statusCode).toBe(401);
    } finally { await setMembershipStatus(fixture, "active"); }
    const start = await doStart(fixture.app, TENANT);
    expect((await doCallback(fixture.app, start.state, start.cookie)).statusCode).toBe(303);
  });
});

/** يبدّل حالة عضوية الهوية المرجعية عبر المالك (بيانات اختبار حصراً) */
async function setMembershipStatus(fixture: FlowFixture, status: string): Promise<void> {
  const client = ownerPrisma(fixture.adminUrl);
  await client.$executeRawUnsafe(`UPDATE "memberships" SET "status"=$1 WHERE "id"='m-oidc-user'`, status);
  await client.$disconnect();
}
