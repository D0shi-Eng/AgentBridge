/**
 * اختبارات مسارات المراقبة — GET /metrics العام، /health/detailed الجلسي،
 * و GET /ops/metrics الجلسي (مصدر صفحة المراقبة بلا توكن في المتصفح).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashApiKey } from "@agentbridge/infra";
import { buildApp } from "../app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "../container.js";
import { authHeader, seedTenant } from "../test-helpers.js";

describe("metrics routes", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "ab-metrics-"));
    container = await buildContainer({ env: developmentEnv(), workRoot });
    app = buildApp(container);
    tenantA = await seedTenant(container, "metrics-a", "مستأجر مقاييس أ");
  });

  afterAll(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it("GET /metrics يعيد http_requests_total بعد 3 طلبات متتالية", async () => {
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });
    await app.inject({ method: "GET", url: "/health" });
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
    expect(response.body).toContain("http_requests_total");
  });

  it("GET /health/detailed خلف مصادقة — بلا رمز 401 ومع رمز 200", async () => {
    const noAuth = await app.inject({ method: "GET", url: "/health/detailed" });
    expect(noAuth.statusCode).toBe(401);
    const withAuth = await app.inject({ method: "GET", url: "/health/detailed", headers: authHeader(tenantA) });
    expect(withAuth.statusCode).toBe(200);
    const body = JSON.parse(withAuth.body) as { status: string; db: string; redis: string };
    expect(body.status).toBe("ok");
    expect(typeof body.db).toBe("string");
  });

  it("GET /health/detailed عزل — مستأجر A لا يسرب", async () => {
    const response = await app.inject({ method: "GET", url: "/health/detailed", headers: authHeader(tenantA) });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as Record<string, unknown>;
    expect(body).not.toHaveProperty("tenantId");
  });

  it("GET /ops/metrics في الوضع الشبكي 403 لمستأجر بالصلاحية — المقاييس العامة للمشغّل حصراً", async () => {
    const anonymous = await app.inject({ method: "GET", url: "/ops/metrics" });
    expect(anonymous.statusCode).toBe(401);
    await app.inject({ method: "GET", url: "/health" });
    const authorized = await app.inject({ method: "GET", url: "/ops/metrics", headers: authHeader(tenantA) });
    // سجل المقاييس يجمّع كل المستأجرين — مستأجر شبكي يُرفض ولو حمل analytics:read
    expect(authorized.statusCode).toBe(403);
    expect(JSON.parse(authorized.body).error.code).toBe("METRICS_OPERATOR_ONLY");
    expect(authorized.body).not.toContain("http_requests_total");
  });

  it("GET /ops/metrics يرفض 403 مفتاحاً بلا analytics:read — الصلاحية مناسبة لا عامة", async () => {
    const limited = await seedTenant(container, "metrics-limited", "مستأجر بلا تحليلات");
    // إعادة كتابة اعتماد المستأجر نفسه بصلاحيات بلا analytics:read حصراً لهذا الاختبار
    await container.authStore.putApiCredential({
      credentialId: `legacy:${limited.tenantId}`, tenantId: limited.tenantId,
      subjectId: `service:${limited.tenantId}`, keyHash: hashApiKey(limited.apiKey),
      permissions: ["resource:read", "artifact:read"],
      authorizationVersion: 2,
    });
    const response = await app.inject({ method: "GET", url: "/ops/metrics", headers: authHeader(limited) });
    expect(response.statusCode).toBe(403);
  });

  it("المسار العام /metrics يبقى كما هو — لا تصادم مع المسار الجلسي", async () => {
    const response = await app.inject({ method: "GET", url: "/metrics" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/plain");
  });
});
