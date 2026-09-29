/**
 * اختبارات رحلة التشغيل — بوابة المراجعة البشرية، عرض الأدوات، وتنزيل الحزمة ZIP.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
/** جذر عمل داخل المستودع للفحوص الحية — انظر شرح repoTempDir في acceptance.spec */
function repoTempDir(prefix: string): string {
  const base = fileURLToPath(new URL("../../../tests/e2e/.tmp", import.meta.url));
  return mkdtempSync(join(base, prefix));
}
import { authHeader, createProject, seedTenant, uploadSpec, waitForStatus } from "./test-helpers.js";

describe("api — مراجعة بشرية وحزمة التنزيل", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  let tenant: Awaited<ReturnType<typeof seedTenant>>;
  let projectId: string;
  let specId: string;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = repoTempDir("ab-journey-");
    container = await buildContainer({ env: developmentEnv(), workRoot, liveProbes: true });
    app = buildApp(container);
    tenant = await seedTenant(container, "journey-tenant", "مستأجر رحلة التشغيل");
    projectId = await createProject(app, tenant);
    specId = await uploadSpec(app, tenant, projectId);
  }, 180_000); // قبلAll يبذر فقط — مهلة تحسباً للفحوص الحية اللاحقة

  afterAll(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("بوابة HITL: requireApproval يوقف بعد evaluate ثم resume يصدر الشهادة", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/pipelines",
      headers: authHeader(tenant),
      payload: { projectId, specId, requireApproval: true },
    });
    expect(response.statusCode).toBe(202);
    const { runId } = JSON.parse(response.body) as { runId: string };

    const status = await waitForStatus(app, tenant, runId, ["suspended"]);
    expect(status).toBe("suspended");

    // الأدوات المصممة معروضة للمراجعة قبل الاعتماد
    const toolsResponse = await app.inject({ method: "GET", url: `/pipelines/${runId}/tools`, headers: authHeader(tenant) });
    expect(toolsResponse.statusCode).toBe(200);
    const { tools } = JSON.parse(toolsResponse.body) as { tools: Array<{ name: string; description: string; endpointIds: string[] }> };
    expect(tools.length).toBeGreaterThanOrEqual(3);
    expect(tools.every((tool) => tool.name.length > 0 && tool.endpointIds.length > 0)).toBe(true);

    // بلا تذكرة موافقة يُرفض الاستئناف فشلاً مغلقاً
    const withoutTicket = await app.inject({ method: "POST", url: `/pipelines/${runId}/resume`, headers: authHeader(tenant) });
    expect(withoutTicket.statusCode).toBe(409);

    // الاعتماد البشري يصدر تذكرة موقعة خادمياً ثم يستهلكها resume مرة واحدة
    const approve = await app.inject({ method: "POST", url: `/pipelines/${runId}/approve`, headers: authHeader(tenant) });
    expect(approve.statusCode).toBe(201);
    const { ticket } = JSON.parse(approve.body) as { ticket: string };
    const resume = await app.inject({ method: "POST", url: `/pipelines/${runId}/resume`, headers: { ...authHeader(tenant), "x-hitl-approval": ticket } });
    expect(resume.statusCode).toBe(202);
    await waitForStatus(app, tenant, runId, ["completed"]);

    const cert = await app.inject({ method: "GET", url: `/pipelines/${runId}/certificate`, headers: authHeader(tenant) });
    expect((JSON.parse(cert.body) as { granted: boolean }).granted).toBe(true);

    // الحزمة ZIP جاهزة: توقيع PK ومسارات المولد داخلها
    const pkg = await app.inject({ method: "GET", url: `/pipelines/${runId}/package`, headers: authHeader(tenant) });
    expect(pkg.statusCode).toBe(200);
    expect(pkg.headers["content-type"]).toContain("application/zip");
    expect(pkg.headers["content-disposition"]).toContain("attachment");
    expect(pkg.rawPayload.subarray(0, 4).toString("binary")).toBe("PK\x03\x04");
    const bodyText = pkg.rawPayload.toString("binary");
    expect(bodyText).toContain("src/server.ts");
    expect(bodyText).toContain("manifest.json");
  }, 40_000);

  it("رفض بشري: reject يحوّل التشغيل الموقف إلى needs_human", async () => {
    const started = await app.inject({
      method: "POST",
      url: "/pipelines",
      headers: authHeader(tenant),
      payload: { projectId, specId, requireApproval: true },
    });
    const { runId } = JSON.parse(started.body) as { runId: string };
    await waitForStatus(app, tenant, runId, ["suspended"]);

    const rejected = await app.inject({ method: "POST", url: `/pipelines/${runId}/reject`, headers: authHeader(tenant) });
    expect(rejected.statusCode).toBe(200);
    const status = await waitForStatus(app, tenant, runId, ["needs_human"]);
    expect(status).toBe("needs_human");

    // لا شهادة ولا حزمة لمشروع مرفوض
    const cert = await app.inject({ method: "GET", url: `/pipelines/${runId}/certificate`, headers: authHeader(tenant) });
    expect(cert.statusCode).toBe(404);
  }, 40_000);

  it("قائمة التشغيلات تعيد تشغيلات المستأجر فقط والأحدث أولاً", async () => {
    const list = await app.inject({ method: "GET", url: "/pipelines", headers: authHeader(tenant) });
    expect(list.statusCode).toBe(200);
    const { pipelines } = JSON.parse(list.body) as { pipelines: Array<{ runId: string; status: string }> };
    expect(pipelines.length).toBeGreaterThanOrEqual(2);
    expect(new Set(pipelines.map((p) => p.status))).toEqual(new Set(["completed", "needs_human"]));
  });

  it("مواصفة مشوهة ترفض منظماً عبر HTTP برسالة عربية ورمز معروف", async () => {
    const badSpec = await uploadSpec(app, tenant, projectId, "openapi: \"3.0.3\"\ninfo:\n  title: مكسورة\n  version: \"1.0.0\"\npaths: {}");
    const started = await app.inject({
      method: "POST",
      url: "/pipelines",
      headers: authHeader(tenant),
      payload: { projectId, specId: badSpec },
    });
    const { runId } = JSON.parse(started.body) as { runId: string };
    const status = await waitForStatus(app, tenant, runId, ["failed", "needs_human"], 30_000);
    expect(["failed", "needs_human"]).toContain(status);
  }, 40_000);
});
