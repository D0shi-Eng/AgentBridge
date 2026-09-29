/**
 * اختبارات واجهة دولاب التعلم L4 — عزل مستأجر + حذف مزدوج + تلوين i18n.
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
  return { tenantId, principal: { actorType: "service", authMethod: "api_key", subjectId: `service:${tenantId}`, tenantId, credentialId: `legacy:${tenantId}`, authorizationVersion: 1, permissions: ["flywheel:read", "flywheel:write"] } };
}

describe("flywheel routes — عزل L4 + حذف", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = mkdtempSync(join(tmpdir(), "ab-flywheel-"));
    container = await buildContainer({ env: developmentEnv(), workRoot });
    app = buildApp(container);
    tenantA = await seedTenant(container, "fly-a", "مستأجر أ");
    tenantB = await seedTenant(container, "fly-b", "مستأجر ب");
  });

  afterAll(() => { rmSync(workRoot, { recursive: true, force: true }); });

  it("GET /flywheel/lessons لِـ B لا يعيد درس A — عزل بنيوي", async () => {
    const now = new Date().toISOString();
    await container.flywheel.saveLesson(context(tenantA.tenantId), { specPattern: "pattern-a-xyz", designDecision: "قرار أ", outcome: "success", score: 88, tenantId: tenantA.tenantId, createdAt: now });
    await container.flywheel.saveLesson(context(tenantB.tenantId), { specPattern: "pattern-b-xyz", designDecision: "قرار ب", outcome: "success", score: 77, tenantId: tenantB.tenantId, createdAt: now });

    const responseA = await app.inject({ method: "GET", url: "/flywheel/lessons", headers: authHeader(tenantA) });
    expect(responseA.statusCode).toBe(200);
    const bodyA = JSON.parse(responseA.body) as { lessons: Array<{ tenantId: string; specPattern: string }> };
    expect(bodyA.lessons.every((lesson) => lesson.tenantId === tenantA.tenantId)).toBe(true);
    expect(bodyA.lessons.some((lesson) => lesson.specPattern === "pattern-a-xyz")).toBe(true);

    const responseB = await app.inject({ method: "GET", url: "/flywheel/lessons", headers: authHeader(tenantB) });
    expect(responseB.statusCode).toBe(200);
    const bodyB = JSON.parse(responseB.body) as { lessons: Array<{ tenantId: string; specPattern: string }> };
    expect(bodyB.lessons.every((lesson) => lesson.tenantId === tenantB.tenantId)).toBe(true);
    expect(bodyB.lessons.some((lesson) => lesson.specPattern === "pattern-a-xyz")).toBe(false);
  });

  it("GET /flywheel/lessons?query=&k= — بحث topK مع عزل", async () => {
    const now = new Date().toISOString();
    await container.flywheel.saveLesson(context(tenantA.tenantId), { specPattern: "search-me-unique", designDecision: "d-search", outcome: "success", score: 60, tenantId: tenantA.tenantId, createdAt: now });
    const response = await app.inject({ method: "GET", url: "/flywheel/lessons?query=search-me-unique&k=3", headers: authHeader(tenantA) });
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { lessons: Array<{ specPattern: string }> };
    expect(body.lessons.some((lesson) => lesson.specPattern === "search-me-unique")).toBe(true);
    // B لا يرى درس A حتى بالبحث نفسه
    const responseB = await app.inject({ method: "GET", url: "/flywheel/lessons?query=search-me-unique&k=3", headers: authHeader(tenantB) });
    const bodyB = JSON.parse(responseB.body) as { lessons: Array<{ specPattern: string }> };
    expect(bodyB.lessons.some((lesson) => lesson.specPattern === "search-me-unique")).toBe(false);
  });

  it("DELETE يحذف من L2 ويزيل فهرس L3 — وA لا يحذف درس B", async () => {
    const now = new Date().toISOString();
    await container.flywheel.saveLesson(context(tenantA.tenantId), { specPattern: "del-pattern", designDecision: "d-del", outcome: "success", score: 70, tenantId: tenantA.tenantId, createdAt: now });
    const before = await app.inject({ method: "GET", url: "/flywheel/lessons", headers: authHeader(tenantA) });
    const lessons = (JSON.parse(before.body) as { lessons: Array<{ id: string; specPattern: string }> }).lessons.filter((lesson) => lesson.specPattern === "del-pattern");
    const id = lessons[0]?.id ?? "";
    expect(id.length).toBeGreaterThan(0);

    // B يحاول حذف id الخاص ب A — لا أثر
    const deleteByB = await app.inject({ method: "DELETE", url: `/flywheel/lessons/${encodeURIComponent(id)}`, headers: authHeader(tenantB) });
    expect(deleteByB.statusCode).toBe(200);
    const stillThere = await app.inject({ method: "GET", url: "/flywheel/lessons", headers: authHeader(tenantA) });
    expect((JSON.parse(stillThere.body) as { lessons: Array<{ id: string }> }).lessons.some((lesson) => lesson.id === id)).toBe(true);

    // A يحذف بنجاح
    const deleteByA = await app.inject({ method: "DELETE", url: `/flywheel/lessons/${encodeURIComponent(id)}`, headers: authHeader(tenantA) });
    expect(deleteByA.statusCode).toBe(200);
    const after = await app.inject({ method: "GET", url: "/flywheel/lessons", headers: authHeader(tenantA) });
    expect((JSON.parse(after.body) as { lessons: Array<{ id: string }> }).lessons.some((lesson) => lesson.id === id)).toBe(false);
  });

  it("i18n: Accept-Language en يعيد رسالة إنجليزية و ar يعيد عربية، و ?lang=en يتجاوز الترويسة", async () => {
    const enHeader = await app.inject({ method: "GET", url: "/projects/invalid-id", headers: { ...authHeader(tenantA), "accept-language": "en" } });
    // مشروع غير موجود → NOT_FOUND بترجمة إنجليزية
    expect(JSON.parse(enHeader.body).error.message).toMatch(/Resource not found|not found/i);

    const arHeader = await app.inject({ method: "GET", url: "/projects/invalid-id", headers: { ...authHeader(tenantA), "accept-language": "ar" } });
    expect(JSON.parse(arHeader.body).error.message).toContain("غير موجود");

    const queryOverride = await app.inject({ method: "GET", url: "/projects/invalid-id?lang=en", headers: { ...authHeader(tenantA), "accept-language": "ar" } });
    expect(JSON.parse(queryOverride.body).error.message).toMatch(/Resource not found|not found/i);
  });
});
