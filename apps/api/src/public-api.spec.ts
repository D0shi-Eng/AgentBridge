/**
 * اختبارات السطح العام: /verify/:id بلا مصادقة،
 * الشارة الملفوفة برابط الصفحة، و/stats بنطاق المستأجر.
 */
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";

/** جذر عمل داخل شجرة المستودع — انظر شرح repoTempDir في acceptance.spec */
function repoTempDir(prefix: string): string {
  return mkdtempSync(join(fileURLToPath(new URL("../../../tests/e2e/.tmp", import.meta.url)), prefix));
}
import {
  authHeader,
  createProject,
  PETSTORE_YAML,
  seedTenant,
  startPipeline,
  uploadSpec,
  waitForStatus,
} from "./test-helpers.js";

describe("السطح العام", () => {
  let container: ApiContainer;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let verificationId: string;

  beforeAll(async () => {
    // جذر عمل داخل المستودع: الخادم المولد يحل اعتمادياته صعوداً (انظر acceptance)
    container = await buildContainer({ env: developmentEnv(), liveProbes: true, workRoot: repoTempDir("ab-public-") });
    app = buildApp(container);
    const tenant = await seedTenant(container, "pub-tenant", "عيادات عامة");
    const projectId = await createProject(app, tenant);
    const specId = await uploadSpec(app, tenant, projectId);
    const runId = await startPipeline(app, tenant, projectId, specId);
    const status = await waitForStatus(app, tenant, runId, ["completed"]);
    expect(status).toBe("completed");
    const certificateResponse = await app.inject({
      method: "GET",
      url: `/pipelines/${runId}/certificate`,
      headers: authHeader(tenant),
    });
    verificationId = (JSON.parse(certificateResponse.body) as { verificationId: string }).verificationId;
  }, 180_000); // رحلة حية كاملة داخل beforeAll

  it("GET /verify/:id يعرض القرار بلا أي مصادقة وبقائمة بيضاء حصراً", async () => {
    const response = await app.inject({ method: "GET", url: `/verify/${verificationId}` });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "artifactsHash",
      "finalScore",
      "granted",
      "issuedAt",
      // علم الإبطال الصريح جزء من القائمة البيضاء الموثقة
      "revoked",
      "signature",
      "verificationId",
    ]);
    expect(body.granted).toBe(true);
    // لا تسريب لأي إشارة مستأجر أو تشغيل
    expect(response.body).not.toContain("pub-tenant");
    expect(JSON.stringify(body)).not.toContain("runId");
  });

  it("رقم بصيغة خاطئة أو غير موجود = 404 واحد بلا تمييز", async () => {
    const malformed = await app.inject({ method: "GET", url: "/verify/not-a-real-id" });
    expect(malformed.statusCode).toBe(404);
    const wellFormedUnknown = await app.inject({ method: "GET", url: "/verify/AB-00000000000000ff" });
    expect(wellFormedUnknown.statusCode).toBe(404);
    expect(JSON.parse(malformed.body).error.message).toBe(
      JSON.parse(wellFormedUnknown.body).error.message,
    );
  });

  it("الشارة ترصد رابط التحقق من الأصل الموثوق حصراً — أي تجاوز من الطلب يُتجاهل", async () => {
    const tenant = await seedTenant(container, "badge-tenant", "شركة الشارة");
    const projectId = await createProject(app, tenant);
    const specId = await uploadSpec(app, tenant, projectId, PETSTORE_YAML);
    const runId = await startPipeline(app, tenant, projectId, specId);
    await waitForStatus(app, tenant, runId, ["completed"]);
    // بلا ترويسات: الرابط من APP_ORIGIN الموثوق لا من Host الوارد (منع cache/host poisoning)
    const direct = await app.inject({ method: "GET", url: `/pipelines/${runId}/badge`, headers: authHeader(tenant) });
    expect(direct.statusCode).toBe(200);
    expect(direct.headers["content-type"]).toContain("image/svg+xml");
    expect(direct.body).toContain('href="http://127.0.0.1:3001/verify/');

    // ترويسات بروكسي غير موثوقة لا تغيّر الرابط — origin ثابت من الإعداد
    const forwarded = await app.inject({
      method: "GET",
      url: `/pipelines/${runId}/badge`,
      headers: { ...authHeader(tenant), host: "internal:3000", "x-forwarded-proto": "https", "x-forwarded-host": "portal.client.io" },
    });
    expect(forwarded.body).toContain('href="http://127.0.0.1:3001/verify/');
    expect(forwarded.body).not.toContain("portal.client.io");
    expect(forwarded.body).not.toContain("internal:3000");

    // لا تجاوز من الطلب أصلاً — حتى ?verifyUrl= السليم يُتجاهل،
    // والمضلل (javascript:) يعود للأصل الموثوق. المصدر إعداد الخادم حصراً.
    const headers = authHeader(tenant);
    const override = await app.inject({
      method: "GET",
      url: `/pipelines/${runId}/badge?verifyUrl=${encodeURIComponent("https://status.example.com/check")}`,
      headers,
    });
    expect(override.body).toContain('href="http://127.0.0.1:3001/verify/');
    expect(override.body).not.toContain("status.example.com");
    const hostile = await app.inject({
      method: "GET",
      url: `/pipelines/${runId}/badge?verifyUrl=${encodeURIComponent('javascript:alert(1)')}`,
      headers,
    });
    expect(hostile.body).toContain('href="http://127.0.0.1:3001/verify/');
    expect(hostile.body).not.toContain("javascript");
  });

  it("GET /stats يعيد أرقام المستأجر الموثق فقط، ويحجب عن الغرباء", async () => {
    const tenant = await seedTenant(container, "stats-tenant", "إحصاءات");
    const empty = await app.inject({ method: "GET", url: "/stats", headers: authHeader(tenant) });
    expect(empty.statusCode).toBe(200);
    expect(JSON.parse(empty.body)).toEqual({
      totalRuns: 0,
      activeRuns: 0,
      grantedCertificates: 0,
      avgFinalScore: null,
      lastRunAt: null,
    });

    const projectId = await createProject(app, tenant);
    const specId = await uploadSpec(app, tenant, projectId);
    const runId = await startPipeline(app, tenant, projectId, specId);
    await waitForStatus(app, tenant, runId, ["completed"]);
    const stats = JSON.parse(
      (await app.inject({ method: "GET", url: "/stats", headers: authHeader(tenant) })).body,
    ) as { totalRuns: number; grantedCertificates: number; avgFinalScore: number };
    expect(stats.totalRuns).toBe(1);
    expect(stats.grantedCertificates).toBe(1);
    expect(stats.avgFinalScore).toBeGreaterThanOrEqual(85);

    const stranger = await seedTenant(container, "stats-stranger", "غريب");
    const strangerStats = JSON.parse(
      (await app.inject({ method: "GET", url: "/stats", headers: authHeader(stranger) })).body,
    ) as { totalRuns: number };
    expect(strangerStats.totalRuns).toBe(0);
  });

  it("لا كتابة على السطح العام ولا قراءة محمية بلا مصادقة", async () => {
    // POST غير موجودة أصلاً فيتولى معالج 404 — لا سطح كتابة عام إطلاقاً
    const post = await app.inject({ method: "POST", url: `/verify/${verificationId}`, payload: {} });
    expect(post.statusCode).toBe(404);
    const noAuth = await app.inject({ method: "GET", url: "/projects" });
    expect(noAuth.statusCode).toBe(401);
  });

  afterAll(async () => {
    await app.close();
  });
});
