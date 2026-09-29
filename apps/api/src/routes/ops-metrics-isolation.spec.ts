/**
 * اختبارات عزل مقاييس المراقبة — إغلاق تسرب مقاييس المستأجرين.
 *
 * السجل العام يجمّع طلبات كل المستأجرين، لذا قراءة مستأجر شبكي له تعدّ كشف
 * نشاط غيره ولو كانت التسميات بلا أسماء. هذه الاختبارات تثبت بالتقسيم الرباعي:
 * مجهول → 401؛ مستأجر شبكي بالصلاحية → 403 منظّم بلا أي نص مقاييس؛ فاقد
 * الصلاحية → 403؛ مشغّل التثبيت المحلي الفردي → 200 بنص Prometheus كامل،
 * بينما مستأجر ثانٍ في التطبيق المحلي نفسه يبقى مرفوضاً.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "@agentbridge/infra";
import { buildApp } from "../app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "../container.js";
import { authHeader, seedTenant, type SeededTenant } from "../test-helpers.js";

describe("عزل /ops/metrics — وضع شبكي بمستأجرين مستقلين", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  let tenantA: SeededTenant;
  let tenantB: SeededTenant;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "ab-ops-iso-"));
    container = await buildContainer({ env: developmentEnv(), workRoot });
    app = buildApp(container);
    tenantA = await seedTenant(container, "ops-iso-a", "مستأجر النشاط أ");
    tenantB = await seedTenant(container, "ops-iso-b", "مستأجر القارئ ب");
    // نشاط حقيقي للمستأجر A — طلبات مصادَقة تدخل في السجل العام
    await app.inject({ method: "GET", url: "/projects", headers: authHeader(tenantA) });
    await app.inject({ method: "GET", url: "/projects", headers: authHeader(tenantA) });
  });

  afterAll(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it("المجهول 401 بلا أي مقاييس", async () => {
    const response = await app.inject({ method: "GET", url: "/ops/metrics" });
    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain("http_requests_total");
  });

  it("مستأجر B بالصلاحية 403 منظّم ولا يرى أي مقاييس — فلا نشاط لـA يتسرب", async () => {
    const response = await app.inject({ method: "GET", url: "/ops/metrics", headers: authHeader(tenantB) });
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("METRICS_OPERATOR_ONLY");
    // لا نص Prometheus إطلاقاً في الرد — عدادات A لا تصل إلى B بأي شكل
    expect(response.body).not.toContain("http_requests_total");
    expect(response.body).not.toContain("http_request_duration_ms");
  });

  it("فاقد الصلاحية 403 — بوابة analytics:read تبقى قبل بوابة المشغّل", async () => {
    const limited = await seedTenant(container, "ops-iso-limited", "بلا تحليلات");
    await container.authStore.putApiCredential({
      credentialId: `legacy:${limited.tenantId}`, tenantId: limited.tenantId,
      subjectId: `service:${limited.tenantId}`,
      keyHash: hashApiKey(limited.apiKey),
      permissions: ["resource:read", "artifact:read"],
      authorizationVersion: 2,
    });
    const response = await app.inject({ method: "GET", url: "/ops/metrics", headers: authHeader(limited) });
    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain("http_requests_total");
  });
});

describe("عزل /ops/metrics — وضع المشغّل المحلي الفردي", () => {
  let app: ReturnType<typeof buildApp>;
  let operator: SeededTenant;
  let second: SeededTenant;
  let workRoot: string;

  // الوضع المحلي يقيد مضيف الطلب بحلقة الاستقبال (حسم DNS rebinding) —
  // كل الطلبات هنا تحمل ترويسة الحلقة المسموحة كما تفعل اللوحة الحية
  const injectLocal = (options: { method: "GET"; url: string; headers?: Record<string, string> }) =>
    app.inject({ ...options, headers: { ...(options.headers ?? {}), host: "127.0.0.1:3000" } });

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "ab-ops-local-"));
    const env = {
      ...developmentEnv(),
      LOCAL_BOOTSTRAP: "1",
      LOCAL_TENANT_ID: "local-owner",
      LOCAL_CREDENTIAL_ID: "local-credential",
    };
    const container = await buildContainer({ env, workRoot });
    app = buildApp(container);
    operator = await seedTenant(container, "local-owner", "مساحة المشغّل المحلية");
    second = await seedTenant(container, "local-second", "مستأجر ثانٍ محلياً");
    await injectLocal({ method: "GET", url: "/health" });
  });

  afterAll(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it("مشغّل المساحة المحلية 200 بنص Prometheus الكامل", async () => {
    const response = await injectLocal({ method: "GET", url: "/ops/metrics", headers: authHeader(operator) });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("http_requests_total");
  });

  it("مستأجر ثانٍ في التطبيق المحلي نفسه يبقى مرفوضاً 403", async () => {
    const response = await injectLocal({ method: "GET", url: "/ops/metrics", headers: authHeader(second) });
    expect(response.statusCode).toBe(403);
    expect(JSON.parse(response.body).error.code).toBe("METRICS_OPERATOR_ONLY");
    expect(response.body).not.toContain("http_requests_total");
  });

  it("المجهول في الوضع المحلي أيضاً 401", async () => {
    const response = await injectLocal({ method: "GET", url: "/ops/metrics" });
    expect(response.statusCode).toBe(401);
  });
});
