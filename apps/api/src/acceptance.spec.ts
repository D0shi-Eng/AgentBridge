/**
 * حدود القبول الرئيسية — كلها عبر HTTP بلا منافذ حقيقية:
 *   1. e2e: رفع mini-petstore → تشغيل → أحداث تبث ترتيبياً → شهادة وشارة.
 *   2. تعدد المستأجرين: B لا يرى شيئاً من A على كل مسارات التشغيل.
 *   3. سلسلة التدقيق: verifyChain نجاح ثم عبث واحد يكسرها.
 *   4. استئناف عبر العملية: إيقاف بعد مرحلة، حاوية جديدة بالمخزنتين فقط،
 *      resume يكمل حتى الشهادة بمخططات shared الجديدة.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StageIds, type PipelineEvent } from "@agentbridge/shared";
import { createInMemorySemanticStore } from "@agentbridge/memory";
import { HashChainAuditLog } from "@agentbridge/infra";
import { buildApp } from "./app.js";
import { buildContainer, developmentEnv, type ApiContainer } from "./container.js";
import { authHeader, createProject, seedTenant, startPipeline, uploadSpec, waitForStatus } from "./test-helpers.js";

/**
 * جذر عمل داخل شجرة المستودع للفحوص الحية: الخادم المولد يحل
 * اعتمادياته صعوداً من مسار ملفه — os tmpdir خارج الشجرة لا يجد SDK.
 * تركيب runner مستقل يعزل هذا كلياً.
 */
function repoTempDir(prefix: string): string {
  const base = fileURLToPath(new URL("../../../tests/e2e/.tmp", import.meta.url));
  return mkdtempSync(join(base, prefix));
}

describe("api — حدود القبول", () => {
  let container: ApiContainer;
  let app: ReturnType<typeof buildApp>;
  let tenantA: Awaited<ReturnType<typeof seedTenant>>;
  let tenantB: Awaited<ReturnType<typeof seedTenant>>;
  let projectId: string;
  let specId: string;
  let runId: string;
  let workRoot: string;

  beforeAll(async () => {
    workRoot = repoTempDir("ab-api-accept-");
    container = await buildContainer({ env: developmentEnv(), workRoot, liveProbes: true });
    app = buildApp(container);
    tenantA = await seedTenant(container, "clinic-a", "عيادات النور");
    tenantB = await seedTenant(container, "lawfirm-b", "مكتب الحقوق");
    projectId = await createProject(app, tenantA, "petstore العيادة");
    specId = await uploadSpec(app, tenantA, projectId);
    runId = await startPipeline(app, tenantA, projectId, specId);
  }, 180_000); // رحلة حية كاملة بفحوص حية — قبلAll يتجاوز المهلة الافتراضية

  afterAll(() => {
    rmSync(workRoot, { recursive: true, force: true });
  });

  it("1) التشغيل يكتمل ويصدر شهادة منححة عبر HTTP", async () => {
    const status = await waitForStatus(app, tenantA, runId, ["completed"]);
    expect(status).toBe("completed");

    const certificateResponse = await app.inject({
      method: "GET",
      url: `/pipelines/${runId}/certificate`,
      headers: authHeader(tenantA),
    });
    expect(certificateResponse.statusCode).toBe(200);
    expect(certificateResponse.headers["content-disposition"]).toContain("attachment");

    const certificate = JSON.parse(certificateResponse.body) as { granted: boolean; finalScore: number };
    expect(certificate.granted).toBe(true);
    expect(certificate.finalScore).toBeGreaterThanOrEqual(85);

    const badgeResponse = await app.inject({ method: "GET", url: `/pipelines/${runId}/badge`, headers: authHeader(tenantA) });
    expect(badgeResponse.statusCode).toBe(200);
    expect(badgeResponse.headers["content-type"]).toContain("image/svg+xml");
    expect(badgeResponse.body).toContain("<svg");
  }, 30_000);

  it("1-ب) الأحداث تُبث NDJSON بترتيب المراحل الملزم", async () => {
    const eventsResponse = await app.inject({
      method: "GET",
      url: `/pipelines/${runId}/events`,
      headers: authHeader(tenantA),
    });
    expect(eventsResponse.statusCode).toBe(200);
    expect(String(eventsResponse.headers["content-type"])).toContain("application/x-ndjson");

    const lines = eventsResponse.body.trim().split("\n").filter((line) => line.length > 0);
    expect(lines.length).toBeGreaterThan(10);

    const events = lines.map((line) => JSON.parse(line) as PipelineEvent);
    expect(events[0]?.stage).toBe("load_spec");

    // الترتيب التنفيذي غير متناقص، وآخر حدث إنهاء الشهادة
    let maxIndex = -1;
    for (const event of events) {
      const index = StageIds.indexOf(event.stage);
      expect(index).toBeGreaterThanOrEqual(maxIndex);
      if (index > maxIndex) maxIndex = index;
    }
    const last = events[events.length - 1];
    expect(last?.stage).toBe("certify");
    expect(last?.stageStatus).toBe("completed");

    // البث يطابق ما في L1 حرفياً (لا فقدان ولا ازدواج)
    const stored = await container.episodic.readEvents(tenantA.tenantId, runId);
    expect(stored.length).toBe(events.length);
  }, 20_000);

  it("2) المستأجر B محجوب عن كل مسارات تشغيل A (اختبار سلبي شامل)", async () => {
    for (const [method, url] of [
      ["GET", `/pipelines/${runId}/status`],
      ["GET", `/pipelines/${runId}/events`],
      ["POST", `/pipelines/${runId}/resume`],
      ["GET", `/pipelines/${runId}/certificate`],
      ["GET", `/pipelines/${runId}/badge`],
    ] as const) {
      const response = await app.inject({ method, url, headers: authHeader(tenantB), payload: method === "POST" ? {} : undefined });
      expect(response.statusCode, `${method} ${url} يجب أن يكون 404 لمستأجر غريب`).toBe(404);
    }
  });

  it("3) سلسلة التدقيق سليمة على التشغيل الكامل وتكسرها زرعة عبث واحدة", async () => {
    const cleanResult = await container.audit.verifyChain(tenantA.tenantId);
    expect(cleanResult.ok).toBe(true);
    if (cleanResult.ok) expect(cleanResult.value.entries).toBeGreaterThanOrEqual(10);

    // زرع العبث: صف واحد بتغيير payload يعاد بناؤه في مخزن جديد كقاعدة معدّلة
    const entries = await container.semantic.listAuditEntries(tenantA.tenantId);
    expect(entries.length).toBeGreaterThan(0);
    const tamperedSink = createInMemorySemanticStore();
    for (const entry of entries.map((entry, index) =>
      index === 1 ? { ...entry, abstractedPayload: "عبث لاحق" } : entry,
    )) {
      await tamperedSink.appendAuditEntry(entry);
    }
    const broken = await new HashChainAuditLog(tamperedSink).verifyChain(tenantA.tenantId);
    expect(broken.ok).toBe(false);
  }, 20_000);

  it("4) الاستئناف عبر العملية: مخزنان فقط يعبران وحاوية جديدة تكمل للشهادة", async () => {
    // عملية أولى بإيقاف متحكم به بعد generate_server
    const firstWorkRoot = repoTempDir("ab-proc1-")
    const secondWorkRoot = repoTempDir("ab-proc2-")
    try {
      const c1 = await buildContainer({
        env: developmentEnv(),
        workRoot: firstWorkRoot,
        liveProbes: true,
        semantic: container.semantic,
        episodic: container.episodic,
        suspendAfter: "generate_server",
      });
      const app1 = buildApp(c1);

      const suspendedProject = await createProject(app1, tenantB, "مشروع الاستئناف");
      const suspendedSpec = await uploadSpec(app1, tenantB, suspendedProject);
      const suspendedRun = await startPipeline(app1, tenantB, suspendedProject, suspendedSpec);

      const status1 = await waitForStatus(app1, tenantB, suspendedRun, ["suspended"]);
      expect(status1).toBe("suspended");

      // عملية ثانية جديدة كلياً — لا شيء منها يعرف التشغيل السابق إلا L1/L2
      const c2 = await buildContainer({
        env: developmentEnv(),
        workRoot: secondWorkRoot,
        liveProbes: true,
        semantic: container.semantic,
        episodic: container.episodic,
      });
      const app2 = buildApp(c2);

      // الحاوية الثانية تصدر التذكرة من مادتها وتستهلكها هنا
      const approveB = await app2.inject({
        method: "POST",
        url: `/pipelines/${suspendedRun}/approve`,
        headers: authHeader(tenantB),
      });
      expect(approveB.statusCode).toBe(201);
      const { ticket } = JSON.parse(approveB.body) as { ticket: string };
      const resumeResponse = await app2.inject({
        method: "POST",
        url: `/pipelines/${suspendedRun}/resume`,
        headers: { ...authHeader(tenantB), "x-hitl-approval": ticket },
      });
      expect(resumeResponse.statusCode).toBe(202);

      const status2 = await waitForStatus(app2, tenantB, suspendedRun, ["completed", "failed", "needs_human"]);
      expect(status2).toBe("completed");

      const certificate = await app2.inject({
        method: "GET",
        url: `/pipelines/${suspendedRun}/certificate`,
        headers: authHeader(tenantB),
      });
      expect(JSON.parse(certificate.body).granted).toBe(true);

      // المراحل الأولى لم تُنفذ مجدداً: أحداث load_spec running = مرة واحدة فقط
      const events = await container.episodic.readEvents(tenantB.tenantId, suspendedRun);
      const loadSpecStarts = events.filter((event) => event.stage === "load_spec" && event.stageStatus === "running");
      expect(loadSpecStarts).toHaveLength(1);

      const chain = await c2.audit.verifyChain(tenantB.tenantId);
      expect(chain.ok).toBe(true);
    } finally {
      rmSync(firstWorkRoot, { recursive: true, force: true });
      rmSync(secondWorkRoot, { recursive: true, force: true });
    }
  }, 60_000);

  it("4-ب) استئناف تشغيل جارٍ يرد 409، واستئناف بلا snapshot يرد NO_SNAPSHOT", async () => {
    // (أ) تشغيل جارٍ بمزود متأخر يرفض استئنافاً موازياً فوراً
    const slowWorkRoot = repoTempDir("ab-slow-")
    try {
      const slowContainer = await buildContainer({
        env: developmentEnv(),
        providerDelayMs: 150,
        workRoot: slowWorkRoot,
      });
      // مستأجر مستقل بذرته في هذه الحاوية وحدها — مفاتيح حاوية أخرى لا تعمل
      const localTenant = await seedTenant(slowContainer, "clinic-slow", "عيادات متأخرة");
      const slowApp = buildApp(slowContainer);
      const slowProject = await createProject(slowApp, localTenant);
      const slowSpec = await uploadSpec(slowApp, localTenant, slowProject);
      const slowRun = await startPipeline(slowApp, localTenant, slowProject, slowSpec);
      expect(slowContainer.runs.isRunning(slowRun)).toBe(true);

      const parallel = await slowApp.inject({
        method: "POST",
        url: `/pipelines/${slowRun}/resume`,
        headers: authHeader(localTenant),
      });
      expect(parallel.statusCode).toBe(409);
      expect(JSON.parse(parallel.body).error.code).toBe("RUN_ALREADY_ACTIVE");
      await waitForStatus(slowApp, localTenant, slowRun, ["completed"]);

      // (ب) صف تشغيل بلا أي snapshot في L1 → رفض NO_SNAPSHOT عربي
      await container.semantic.upsertPipeline({
        runId: "orphan-run",
        tenantId: tenantA.tenantId,
        projectId,
        specId,
        status: "failed",
        repairCyclesUsed: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const noSnapshot = await app.inject({
        method: "POST",
        url: "/pipelines/orphan-run/resume",
        headers: authHeader(tenantA),
      });
      expect(noSnapshot.statusCode).toBe(409);
      expect(JSON.parse(noSnapshot.body).error.code).toBe("NO_SNAPSHOT");
    } finally {
      rmSync(slowWorkRoot, { recursive: true, force: true });
    }
  }, 40_000);
});
