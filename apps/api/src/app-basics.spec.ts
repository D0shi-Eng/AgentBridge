/**
 * اختبارات الأساسيات عبر inject — الصحة، المصادقة، المشاريع، المواصفات،
 * معالجة الأخطاء الآمنة، ورفض إقلاع config.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import { authHeader, createProject, seedTenant, uploadSpec } from "./test-helpers.js";

describe("api — الأساسيات", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "ab-api-basic-"));
    container = await buildContainer({ env: developmentEnv(), workRoot });
    app = buildApp(container);
    tenantA = await seedTenant(container, "clinic-a", "عيادات النور");
    tenantB = await seedTenant(container, "lawfirm-b", "مكتب الحقوق");
  });

  afterAll(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("الصحة عامة بلا مصادقة", async () => {
    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ status: "ok" });
  });

  it("المصادقة: غياب الترويسة وصيغة فاسدة ومستأجر مجهول وسر خاطئ = رد 401 واحد", async () => {
    for (const headers of [
      {},
      { authorization: "شكل-غير-صالح" },
      { authorization: "Bearer ghost-tenant:somesecret" },
      { authorization: `Bearer ${tenantA.tenantId}:wrong-secret-value` },
    ]) {
      const response = await app.inject({ method: "GET", url: "/projects", headers });
      expect(response.statusCode).toBe(401);
      expect(JSON.parse(response.body).error.message).toContain("بيانات المصادقة");
    }
  });

  it("ترويسة x-api-key بديلة مقبولة", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/projects",
      headers: { "x-api-key": `${tenantA.tenantId}:${tenantA.apiKey}` },
    });
    expect(response.statusCode).toBe(200);
  });

  it("رحلة مشروع كاملة: إنشاء وقائمة وجلب بالمفتاح", async () => {
    const projectId = await createProject(app, tenantA, "مشروع العيادة");
    const listResponse = await app.inject({ method: "GET", url: "/projects", headers: authHeader(tenantA) });
    expect((JSON.parse(listResponse.body) as { projects: unknown[] }).projects).toHaveLength(1);

    const getResponse = await app.inject({
      method: "GET",
      url: `/projects/${projectId}`,
      headers: authHeader(tenantA),
    });
    expect(getResponse.statusCode).toBe(200);
    expect(JSON.parse(getResponse.body).name).toBe("مشروع العيادة");
  });

  it("رفع مواصفة سليم يرجع specId وحجم البايتات", async () => {
    const projectId = await createProject(app, tenantA);
    const response = await app.inject({
      method: "POST",
      url: "/specs",
      headers: authHeader(tenantA),
      payload: { projectId, content: "openapi: 3.0.3\ninfo:\n  title: T" },
    });
    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body) as { specId: string; bytes: number };
    expect(body.specId.length).toBeGreaterThan(10);
    expect(body.bytes).toBeGreaterThan(0);
  });

  it("مواصفة أكبر من الحد ترفض 413 برسالة عربية", async () => {
    const projectId = await createProject(app, tenantA);
    const response = await app.inject({
      method: "POST",
      url: "/specs",
      headers: authHeader(tenantA),
      payload: { projectId, content: "x".repeat(512 * 1024 + 1) },
    });
    expect(response.statusCode).toBe(413);
    expect(JSON.parse(response.body).error.code).toBe("SPEC_TOO_LARGE");
  });

  it("رفع لمشروع غير مملوك = 404 لا 403 (بلا تسريب وجود)", async () => {
    const projectOfB = await createProject(app, tenantB);
    const response = await app.inject({
      method: "POST",
      url: "/specs",
      headers: authHeader(tenantA),
      payload: { projectId: projectOfB, content: "openapi: 3.0.3" },
    });
    expect(response.statusCode).toBe(404);
  });

  it("جسم JSON تالف يرد 400 عربي ومسار مجهول يرد 404 موحد", async () => {
    const badJson = await app.inject({
      method: "POST",
      url: "/specs",
      headers: { ...authHeader(tenantA), "content-type": "application/json" },
      payload: "{broken",
    });
    expect(badJson.statusCode).toBe(400);
    expect(JSON.parse(badJson.body).error.message).toContain("غير صالح");

    const missingRoute = await app.inject({ method: "GET", url: "/nope", headers: authHeader(tenantA) });
    expect(missingRoute.statusCode).toBe(404);
    expect(JSON.parse(missingRoute.body).error.code).toBe("NOT_FOUND");
  });

  it("buildContainer يرفض إقلاع config بمفتاح تشفير قصير برسالة عربية", async () => {
    // async الحاوية: الرفض الآن وعد مرفوض لا استثناء متزامن
    const weakEnv = { ...developmentEnv(), ENCRYPTION_KEY: Buffer.from("short").toString("base64") };
    await expect(buildContainer({ env: weakEnv })).rejects.toThrow(/رفض الإقلاع[\s\S]*32 بايت/u);
    await expect(buildContainer({ env: { ...developmentEnv(), ENCRYPTION_KEY: "" } })).rejects.toThrow(/ENCRYPTION_KEY مفقود/u);
  });

  it("المستأجر B لا يرى مشاريع أو مواصفات A على كل المسارات المقروءة", async () => {
    const projectId = await createProject(app, tenantA);
    const specId = await uploadSpec(app, tenantA, projectId);

    const projectView = await app.inject({ method: "GET", url: `/projects/${projectId}`, headers: authHeader(tenantB) });
    expect(projectView.statusCode).toBe(404);

    const specView = await app.inject({ method: "GET", url: `/specs/${specId}`, headers: authHeader(tenantB) });
    expect(specView.statusCode).toBe(404);
  });
});
