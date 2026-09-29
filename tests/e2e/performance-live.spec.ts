/**
 * القياس الحي — زمن الخط الكامل على الواقعيتين فوق PostgreSQL+Redis
 * فعليين، بقياس مرجعي داخل الذاكرة في نفس التشغيل لاستخلاص الفارق.
 * الأرقام تُطبع موثقة وتُنسخ يدوياً إلى توثيق الأداء.
 *
 * النمط المعتمد: قاعدة مؤقتة مكتملة الهجرات بمالك منفصل ودور تشغيل فريد
 * — والتنظيف إسقاط القاعدة كاملة. غياب البنية = تخطٍّ موثق باسمه.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { generateEncryptionKeyBase64 } from "@agentbridge/infra";
import { buildApp } from "@agentbridge/api";
import { buildContainer, developmentEnv, type ApiContainer } from "@agentbridge/api/container";
import { authHeader, createProject, seedTenant, startPipeline, uploadSpec, waitForStatus } from "@agentbridge/api/test-helpers";
import { REDIS_URL, probeLiveInfrastructure } from "./live-probe.js";
import { createMigratedDb, dropEphemeralDatabase } from "./upgrade-harness.js";

/** جذر عمل داخل شجرة المستودع: الخادم المولد يحل اعتمادياته صعوداً من مسار ملفه */
function repoTempDir(prefix: string): string {
  return mkdtempSync(join(fileURLToPath(new URL("./.tmp", import.meta.url)), prefix));
}

const available = await probeLiveInfrastructure();
if (!available) {
  console.info("[تخطٍّ موثق] قياس الأداء الحي: لا Postgres+Redis حيّين — أقلع docker-compose.dev.yaml أولاً");
}

const FIXTURES = [
  { name: "crm-clinic.yaml", path: "../fixtures/crm-clinic.yaml", tools: 23 },
  { name: "booking-office.yaml", path: "../fixtures/booking-office.yaml", tools: 20 },
] as const;

interface RunResult {
  readonly elapsedMs: number;
  readonly score: number;
  readonly granted: boolean;
}

async function fullPipeline(env: Readonly<Record<string, string>>, fixturePath: string, expectedTools: number): Promise<RunResult> {
  const container: ApiContainer = await buildContainer({ env: { ...env }, liveProbes: true, workRoot: repoTempDir("perf-live-") });
  const app = buildApp(container);
  try {
    const tenant = await seedTenant(container, `perf-${randomUUID().slice(0, 8)}`, "قياس أداء");
    const projectId = await createProject(app, tenant);
    const specId = await uploadSpec(app, tenant, projectId, readFileSync(fileURLToPath(new URL(fixturePath, import.meta.url)), "utf8"));
    const startedAt = Date.now();
    const runId = await startPipeline(app, tenant, projectId, specId);
    const status = await waitForStatus(app, tenant, runId, ["completed", "failed"], 60_000);
    expect(status).toBe("completed");
    const certificate = JSON.parse(
      (await app.inject({ method: "GET", url: `/pipelines/${runId}/certificate`, headers: authHeader(tenant) })).body,
    ) as { finalScore: number; granted: boolean };
    const tools = JSON.parse(
      (await app.inject({ method: "GET", url: `/pipelines/${runId}/tools`, headers: authHeader(tenant) })).body,
    ) as { tools: unknown[] };
    expect(tools.tools.length).toBe(expectedTools);
    expect(certificate.granted).toBe(true);
    return { elapsedMs: Date.now() - startedAt, score: certificate.finalScore, granted: certificate.granted };
  } finally {
    await app.close();
    await container.close?.();
  }
}

describe.skipIf(!available)("الأداء فوق البنية الحية مقابل داخل الذاكرة", () => {
  let database = "";
  afterAll(async () => {
    // التنظيف: إسقاط القاعدة المؤقتة كاملة — لا بقايا قياس في أي طبقة
    if (database !== "") await dropEphemeralDatabase(database);
  });

  it("الواقعيتان تكتملان بشهادتين فوق Postgres+Redis والأزمنة توثق بالطباعة", async () => {
    // قاعدة مؤقتة بمالك منفصل + دور تشغيل مقيد فريد + مفتاح جلسة حقيقي
    const provisioned = await createMigratedDb();
    database = provisioned.database;
    const restrictedUrl = await import("./rls-live-harness.js").then((m) => m.provisionRestrictedRole(provisioned.adminUrl, database));
    const liveEnv = {
      ...developmentEnv(), DATABASE_URL: restrictedUrl, REDIS_URL, PERSISTENCE: "live",
      ENCRYPTION_KEY: generateEncryptionKeyBase64(),
    };
    for (const fixture of FIXTURES) {
      const result = await fullPipeline(liveEnv, fixture.path, fixture.tools);
      console.info(
        `[أداء حي] ${fixture.name}: ${result.elapsedMs}ms · شهادة ${result.score}/100 منححة=${String(result.granted)} · أدوات=${fixture.tools}`,
      );
      // الهدف الثابت <60 ثانية يبقى ساريًا فوق البنية الحية
      expect(result.elapsedMs).toBeLessThan(60_000);
    }

    // مرجع داخل الذاكرة لنفس المواصفة الثانية — الفارق هو كلفة persistence الحية
    const memoryResult = await fullPipeline(developmentEnv(), FIXTURES[1].path, FIXTURES[1].tools);
    console.info(`[أداء مرجعي InMemory] ${FIXTURES[1]?.name}: ${memoryResult.elapsedMs}ms`);
  }, 240_000);
});
