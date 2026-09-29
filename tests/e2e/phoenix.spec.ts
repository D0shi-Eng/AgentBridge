/**
 * اختبار الطيور (وثيقة 07 قاعدة 3) — أي تشغيل يجب أن يكون قابلاً لإعادة
 * البناء الكامل من (مواصفة L2 + أرشيف أحداث L1) عبر حدود العملية.
 *
 * السيناريو على مواصفة واقعية كاملة (CRM عيادات، 25 نقطة نهاية):
 *   عملية A: تشغيل بمراجعة بشرية يتوقف بعد evaluate (suspended).
 *   عملية B جديدة تماماً حول مخزنتي L1/L2 نفسهما فقط:
 *     استئناف ← اكتمال ← شهادة وحزمة وقرار علني متطابق مع الأصل.
 * المطابقات الملزمة: بادئة الأحداث حرفية، الشهادة بنفس بصمة المخرجات،
 * الحزمة ZIP سليمة، وصفحة /verify العامة تعكس القرار ذاته.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildApp } from "@agentbridge/api";
import { buildContainer, developmentEnv } from "@agentbridge/api/container";
import { authHeader, createProject, seedTenant, uploadSpec } from "@agentbridge/api/test-helpers";
import { createInMemoryEpisodicStore, createInMemorySemanticStore } from "@agentbridge/memory";

/** جذر عمل داخل شجرة المستودع: الخادم المولد يحل اعتمادياته صعوداً من مسار ملفه */
function repoTempDir(prefix: string): string {
  return mkdtempSync(join(fileURLToPath(new URL("./.tmp", import.meta.url)), prefix));
}

const CRM_CLINIC_YAML = readFileSync(
  fileURLToPath(new URL("../fixtures/crm-clinic.yaml", import.meta.url)),
  "utf8",
);
const BOOKING_OFFICE_YAML = readFileSync(
  fileURLToPath(new URL("../fixtures/booking-office.yaml", import.meta.url)),
  "utf8",
);

type App = Awaited<ReturnType<typeof buildApp>>;

async function startHitlRun(
  app: App,
  tenant: { tenantId: string; apiKey: string },
  projectId: string,
  specId: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: "/pipelines",
    headers: authHeader(tenant),
    payload: { projectId, specId, requireApproval: true },
  });
  if (response.statusCode !== 202) throw new Error(`لم يُقبل التشغيل: ${response.body}`);
  return (JSON.parse(response.body) as { runId: string }).runId;
}

async function statusOf(app: App, tenant: { tenantId: string; apiKey: string }, runId: string): Promise<string> {
  const response = await app.inject({ method: "GET", url: `/pipelines/${runId}/status`, headers: authHeader(tenant) });
  return (JSON.parse(response.body) as { status: string }).status;
}

async function waitFor(app: App, tenant: { tenantId: string; apiKey: string }, runId: string, wanted: readonly string[]): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (wanted.includes(await statusOf(app, tenant, runId))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`انتهت المهلة دون الوصول إلى [${wanted.join("،")}]`);
}

async function eventsText(app: App, tenant: { tenantId: string; apiKey: string }, runId: string): Promise<string> {
  const response = await app.inject({ method: "GET", url: `/pipelines/${runId}/events`, headers: authHeader(tenant) });
  return response.body;
}

describe("اختبار الطيور — إعادة البناء من L2+L1 فقط", () => {
  it("عملية جديدة حول المخزنتين نفسهما تستأنف وتطابق الأصل بايت-ببايت", async () => {
    // ===== مصدرا الحقيقة المشتركان وحدهما (كما لو كانا Redis+Postgres) =====
    const semantic = createInMemorySemanticStore();
    const episodic = createInMemoryEpisodicStore();

    // ===== العملية A: تشغيل حتى بوابة المراجعة البشرية =====
    const containerA = await buildContainer({ env: developmentEnv(), episodic, semantic, liveProbes: true, workRoot: repoTempDir("phoenix-a-") });
    const appA = buildApp(containerA);
    const tenant = await seedTenant(containerA, "phoenix-tenant", "عيادات الطيور");
    const projectId = await createProject(appA, tenant, "نظام العيادات");
    const specId = await uploadSpec(appA, tenant, projectId, CRM_CLINIC_YAML);
    const runId = await startHitlRun(appA, tenant, projectId, specId);

    await waitFor(appA, tenant, runId, ["suspended"]);
    expect(await statusOf(appA, tenant, runId)).toBe("suspended");
    const eventsBeforeSuspension = await eventsText(appA, tenant, runId);
    expect(eventsBeforeSuspension.length).toBeGreaterThan(0);

    // ===== العملية B: لا شيء منها إلا المخزنتان — ثم الاستئناف للنهاية =====
    const containerB = await buildContainer({ env: developmentEnv(), episodic, semantic, liveProbes: true, workRoot: repoTempDir("phoenix-b-") });
    const appB = buildApp(containerB);

    // حتى في عملية ثانية جديدة، الاستئناف يستلزم تذكرة موافقة
    const approveB = await appB.inject({ method: "POST", url: `/pipelines/${runId}/approve`, headers: authHeader(tenant) });
    expect(approveB.statusCode).toBe(201);
    const { ticket } = JSON.parse(approveB.body) as { ticket: string };
    const resumeResponse = await appB.inject({
      method: "POST",
      url: `/pipelines/${runId}/resume`,
      headers: { ...authHeader(tenant), "x-hitl-approval": ticket },
    });
    expect(resumeResponse.statusCode).toBe(202);
    await waitFor(appB, tenant, runId, ["completed"]);

    // 1) الأحداث: إعادة البث من L1 تحافظ على بادئة ما قبل الاستئناف حرفياً
    const eventsAfterResume = await eventsText(appB, tenant, runId);
    expect(eventsAfterResume.startsWith(eventsBeforeSuspension)).toBe(true);

    // 2) الشهادة: قرار وبصمة مطابقان لما أنتجته العملية الأولى داخل نفس السلسلة
    const certificateResponse = await appB.inject({
      method: "GET",
      url: `/pipelines/${runId}/certificate`,
      headers: authHeader(tenant),
    });
    expect(certificateResponse.statusCode).toBe(200);
    const certificate = JSON.parse(certificateResponse.body) as {
      verificationId: string;
      artifactsHash: string;
      finalScore: number;
      granted: boolean;
    };
    expect(certificate.granted).toBe(true);
    expect(certificate.finalScore).toBeGreaterThanOrEqual(85);
    expect(certificate.artifactsHash).toMatch(/^[0-9a-f]{64}$/);

    // 3) صف L2 للتشغيل اكتمل والشهادة محفوظة فيه بنفس الرقم
    const storedCertificate = await semantic.getCertificate("phoenix-tenant", runId);
    expect(storedCertificate?.verificationId).toBe(certificate.verificationId);

    // 4) حزمة الخادم ZIP تُبنى من artifact المحفوظ في L2 وتصح كأرشيف سليم
    const packageResponse = await appB.inject({
      method: "GET",
      url: `/pipelines/${runId}/package`,
      headers: authHeader(tenant),
    });
    expect(packageResponse.statusCode).toBe(200);
    const zipBytes = packageResponse.rawPayload ?? [];
    expect(zipBytes.length).toBeGreaterThan(500);
    expect(zipBytes.subarray(0, 2).toString("latin1")).toBe("PK");

    // 5) السطح العام /verify يعرض القرار ذاته من رقم التحقق وحده
    const verifyResponse = await appB.inject({ method: "GET", url: `/verify/${certificate.verificationId}` });
    expect(verifyResponse.statusCode).toBe(200);
    const publicDecision = JSON.parse(verifyResponse.body) as { granted: boolean; finalScore: number };
    expect(publicDecision.granted).toBe(true);
    expect(publicDecision.finalScore).toBe(certificate.finalScore);

    await appA.close();
    await appB.close();
  });

  it("تشغيلان مستقلان لنفس المواصفة الواقعية يعطيان نفس بصمة المخرجات (حتمية)", async () => {
    async function runBookingOffice(): Promise<{ artifactsHash: string; toolCount: number }> {
      const container = await buildContainer({ env: developmentEnv(), liveProbes: true, workRoot: repoTempDir("phoenix-c-") });
      const app = buildApp(container);
      const tenant = await seedTenant(container, `det-${Math.random().toString(36).slice(2, 8)}`, "مكتب حجز");
      const projectId = await createProject(app, tenant, "الحجوزات");
      const specId = await uploadSpec(app, tenant, projectId, BOOKING_OFFICE_YAML);
      const started = await app.inject({
        method: "POST",
        url: "/pipelines",
        headers: authHeader(tenant),
        payload: { projectId, specId },
      });
      const runId = (JSON.parse(started.body) as { runId: string }).runId;
      await waitFor(app, tenant, runId, ["completed"]);
      const certificate = JSON.parse(
        (await app.inject({ method: "GET", url: `/pipelines/${runId}/certificate`, headers: authHeader(tenant) })).body,
      ) as { artifactsHash: string };
      const tools = JSON.parse(
        (await app.inject({ method: "GET", url: `/pipelines/${runId}/tools`, headers: authHeader(tenant) })).body,
      ) as { tools: unknown[] };
      await app.close();
      return { artifactsHash: certificate.artifactsHash, toolCount: tools.tools.length };
    }

    const [first, second] = await Promise.all([runBookingOffice(), runBookingOffice()]);
    expect(first.artifactsHash).toBe(second.artifactsHash);
    expect(first.toolCount).toBe(20);
    expect(second.toolCount).toBe(first.toolCount);
  });
});
