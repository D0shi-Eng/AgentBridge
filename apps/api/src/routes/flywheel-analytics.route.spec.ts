/**
 * اختبارات مسار تحليلات Flywheel — عزل مستأجر + تحقق Zod للـ range.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "../container.js";
import { authHeader, seedTenant } from "../test-helpers.js";
import type { TenantContext } from "@agentbridge/shared";

function context(tenantId: string): TenantContext {
  return { tenantId, principal: { actorType: "service", authMethod: "api_key", subjectId: `service:${tenantId}`, tenantId, credentialId: `legacy:${tenantId}`, authorizationVersion: 1, permissions: ["analytics:read", "flywheel:write"] } };
}

describe("flywheel analytics routes — عزل + range", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "ab-fly-analytics-"));
    container = await buildContainer({ env: developmentEnv(), workRoot });
    app = buildApp(container);
    tenantA = await seedTenant(container, "fly-analytics-a", "مستأجر تحليلات أ");
    tenantB = await seedTenant(container, "fly-analytics-b", "مستأجر تحليلات ب");
  });

  afterAll(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it("GET /flywheel/analytics لِـ B لا يحسب درس A — عزل بنيوي", async () => {
    const now = new Date().toISOString();
    await container.flywheel.saveLesson(context(tenantA.tenantId), { specPattern: "analytics-A", designDecision: "dA", outcome: "success", score: 88, tenantId: tenantA.tenantId, createdAt: now });
    await container.flywheel.saveLesson(context(tenantA.tenantId), { specPattern: "analytics-A", designDecision: "dA2", outcome: "success", score: 92, tenantId: tenantA.tenantId, createdAt: now });
    await container.flywheel.saveLesson(context(tenantB.tenantId), { specPattern: "analytics-B", designDecision: "dB", outcome: "failure", score: 40, tenantId: tenantB.tenantId, createdAt: now });

    const responseA = await app.inject({ method: "GET", url: "/flywheel/analytics?range=7d", headers: authHeader(tenantA) });
    expect(responseA.statusCode).toBe(200);
    const bodyA = JSON.parse(responseA.body) as { totalLessons: number; histogram: number[]; topPatterns: Array<{ pattern: string }> };
    expect(bodyA.totalLessons).toBe(2);
    expect(bodyA.histogram.reduce((a, b) => a + b, 0)).toBe(bodyA.totalLessons);
    expect(bodyA.topPatterns.some((p) => p.pattern === "analytics-A")).toBe(true);
    expect(bodyA.topPatterns.some((p) => p.pattern === "analytics-B")).toBe(false);

    const responseB = await app.inject({ method: "GET", url: "/flywheel/analytics?range=7d", headers: authHeader(tenantB) });
    expect(responseB.statusCode).toBe(200);
    const bodyB = JSON.parse(responseB.body) as { totalLessons: number; topPatterns: Array<{ pattern: string }> };
    expect(bodyB.totalLessons).toBe(1);
    expect(bodyB.topPatterns.some((p) => p.pattern === "analytics-B")).toBe(true);
    expect(bodyB.topPatterns.some((p) => p.pattern === "analytics-A")).toBe(false);
  });

  it("range غير صالح يعيد 400", async () => {
    const response = await app.inject({ method: "GET", url: "/flywheel/analytics?range=invalid", headers: authHeader(tenantA) });
    expect(response.statusCode).toBe(400);
  });

  it("histogram مجموعها = total وsuccessRate حتمي", async () => {
    const response = await app.inject({ method: "GET", url: "/flywheel/analytics?range=30d", headers: authHeader(tenantA) });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { totalLessons: number; histogram: number[]; successRate: number };
    expect(body.histogram.length).toBe(5);
    expect(body.histogram.reduce((a, b) => a + b, 0)).toBe(body.totalLessons);
    expect(body.successRate).toBeGreaterThanOrEqual(0);
    expect(body.successRate).toBeLessThanOrEqual(1);
  });
});
