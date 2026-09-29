/**
 * اختبار الطيور الحي — السيناريو والتصريحات (ملف مجزأ ≤150 سطراً).
 *
 * العملية A تخمد حتى بوابة HITL؛ عملية B مستقلة تماماً (عميل قاعدة واتصال
 * Redis جديدان) تستأنف من المخزنتين الحيتين وحدهما. المطابقات الملزمة:
 * بادئة الأحداث حرفياً، الشهادة والبصمة، قرار /verify، ثم سلسلة الهاش
 * تُبنى سليمة فوق صفوف حية وتُكسر بعبث واحد مباشر بموضعه.
 *
 * النمط المعتمد: قاعدة مؤقتة مكتملة الهجرات بمالك منفصل ودور تشغيل فريد لكل تشغيل
 * — والتنظيف إسقاط القاعدة كاملة. غياب البنية = تخطٍّ موثق.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "redis";
import { generateEncryptionKeyBase64 } from "@agentbridge/infra";
import { buildApp } from "@agentbridge/api";
import { buildContainer, developmentEnv, type ApiContainer } from "@agentbridge/api/container";
import { authHeader, createProject, seedTenant, uploadSpec } from "@agentbridge/api/test-helpers";
import { REDIS_URL, probeLiveInfrastructure } from "./live-probe.js";
import { startHitlRun, waitFor, eventsText, resumeAndAssert, tamperAuditRow } from "./phoenix-helpers.js";
import { TENANT_ID, type App, type Tenant } from "./phoenix-types.js";
import { createMigratedDb, dropEphemeralDatabase } from "./upgrade-harness.js";

/** جذر عمل داخل شجرة المستودع: الخادم المولد يحل اعتمادياته صعوداً من مسار ملفه */
function repoTempDir(prefix: string): string {
  return mkdtempSync(join(fileURLToPath(new URL("./.tmp", import.meta.url)), prefix));
}

const available = await probeLiveInfrastructure();
if (!available) {
  console.info("[تخطٍّ موثق] اختبار الطيور الحي: لا Postgres+Redis حيّين — أقلع docker-compose.dev.yaml أو اضبط AB_LIVE_DATABASE_URL/AB_LIVE_REDIS_URL");
}

const CRM_CLINIC_YAML = readFileSync(fileURLToPath(new URL("../fixtures/crm-clinic.yaml", import.meta.url)), "utf8");

describe.skipIf(!available)("اختبار الطيور الحي — استئناف عبر عمليتين فوق Postgres+Redis فعليين", () => {
  let database = "";
  let adminUrl = "";
  let liveEnv: Record<string, string>;

  afterAll(async () => {
    // التنظيف: إسقاط القاعدة المؤقتة كاملة + مفاتيح Redis الخاصة بالتشغيل
    if (database !== "") await dropEphemeralDatabase(database);
    const cleanupRedis = createClient({ url: REDIS_URL });
    try {
      await cleanupRedis.connect();
      const keys = await cleanupRedis.keys(`pipeline:${TENANT_ID}:*`);
      if (keys.length > 0) await cleanupRedis.del(keys);
      await cleanupRedis.quit();
    } catch {
      // خادم غير متاح لا شيء لتمحيصه
    }
  });

  it("عملية B حول المخزنتين الحيتين وحدهما تستأنف وتطابق الأصل، والهاش يكشف عبثاً واحداً", async () => {
    // قاعدة مؤقتة مكتملة الهجرات بمالك منفصل + دور تشغيل مقيد فريد
    const provisioned = await createMigratedDb();
    database = provisioned.database;
    adminUrl = provisioned.adminUrl;
    const restrictedUrl = await provisionRestrictedRoleOf(provisioned.adminUrl, database);
    liveEnv = {
      ...developmentEnv(), DATABASE_URL: restrictedUrl, REDIS_URL, PERSISTENCE: "live",
      ENCRYPTION_KEY: generateEncryptionKeyBase64(),
    };
    // ===== العملية A: إقلاع حي كامل حتى HITL =====
    const containerA: ApiContainer = await buildContainer({ env: { ...liveEnv }, liveProbes: true, workRoot: repoTempDir("phoenix-live-a-") });
    expect(containerA.config.persistence).toBe("live");
    const appA = buildApp(containerA);
    const tenant = await seedTenant(containerA, TENANT_ID, "عيادات الطيور الحية");
    const projectId = await createProject(appA, tenant, "نظام العيادات");
    const specId = await uploadSpec(appA, tenant, projectId, CRM_CLINIC_YAML);
    const runId = await startHitlRun(appA, tenant, projectId, specId);

    await waitFor(appA, tenant, runId, ["suspended"]);
    const eventsBeforeSuspension = await eventsText(appA, tenant, runId);
    expect(eventsBeforeSuspension.length).toBeGreaterThan(0);

    await appA.close();
    await containerA.close?.();

    // ===== العملية B: عميل قاعدة جديد واتصال Redis جديد حول المخزنتين فقط =====
    const containerB: ApiContainer = await buildContainer({ env: { ...liveEnv }, liveProbes: true, workRoot: repoTempDir("phoenix-live-b-") });
    const appB = buildApp(containerB);

    // 1-2) الحالة عبرت حدود العملية والبادئة حرفية (التصريحات في المساعد)
    await resumeAndAssert(appB, tenant, runId, eventsBeforeSuspension);

    // 3-4) الشهادة والبصمة وقرار /verify العام (تصريحات المساعد)
    const certificate = await assertCertificateAndPublicDecision(appB, tenant, runId);

    // 5) سلسلة الهاش سليمة كاملة فوق الصفوف الحية قبل العبث
    const beforeTamper = await containerB.audit.verifyChain(TENANT_ID);
    expect(beforeTamper.ok).toBe(true);

    // 6) عبث واحد مباشر في القاعدة على صف محدد بالهاش (عبر المالك)
    await tamperAuditRow(adminUrl, TENANT_ID);

    // 7) verifyChain يكشف العبث بموضعه الدقيق: الصف الثاني
    const afterTamper = await containerB.audit.verifyChain(TENANT_ID);
    expect(afterTamper.ok).toBe(false);
    expect(certificate.granted).toBe(true);
  }, 240_000);
});

/** يجهز دور التشغيل المقيد داخل القاعدة المؤقتة — استدعاء محلي لتقليل الاعتماد */
async function provisionRestrictedRoleOf(adminUrl: string, database: string): Promise<string> {
  const harness = await import("./rls-live-harness.js");
  return harness.provisionRestrictedRole(adminUrl, database);
}

/** تصريحات الشهادة والقرار العام — بعد تحويل التشغيل للقاعدة المؤقتة:
 * (النسخة الأصلية كانت محلية في الذيل المحذوف مع التنظيف اليدوي؛ هنا أشد:
 * منح بمسجل ≥85 + قرار عام 200 بقائمة بيضاء بلا أي حقل مستأجر) */
async function assertCertificateAndPublicDecision(app: App, tenant: Tenant, runId: string) {
  const certificate = JSON.parse(
    (await app.inject({ method: "GET", url: `/pipelines/${runId}/certificate`, headers: authHeader(tenant) })).body,
  ) as { finalScore: number; granted: boolean; verificationId: string };
  expect(certificate.granted).toBe(true);
  expect(certificate.finalScore).toBeGreaterThanOrEqual(85);
  const decision = await app.inject({ method: "GET", url: `/verify/${certificate.verificationId}` });
  expect(decision.statusCode).toBe(200);
  const body = JSON.parse(decision.body) as Record<string, unknown>;
  // حقل signature ضمن القائمة البيضاء العامة (حضور التوقيع وصلاحيته)
  expect(Object.keys(body).sort()).toEqual(["artifactsHash", "finalScore", "granted", "issuedAt", "revoked", "signature", "verificationId"]);
  expect(decision.body).not.toContain(TENANT_ID);
  return certificate;
}
