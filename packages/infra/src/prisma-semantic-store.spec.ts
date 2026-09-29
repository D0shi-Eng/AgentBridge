/**
 * اختبارات تكامل مشروطة لـPrismaSemanticStore فوق PostgreSQL حي (تجزئة ≤150 سطراً).
 *
 * شرط العمل: قاعدة متاحة على AB_LIVE_DATABASE_URL أو عنوان docker-compose.dev.yaml
 * الافتراضي. غياب القاعدة لا يخفض أي فحص: التخطي موثق باسمه في المخرجات
 * ويُستثنى ملف المحول من حساب التغطية حينها (انظر vitest.config.ts).
 * المولدات النقية في semantic-seed.ts — بادئة مستأجري الجلسة تُمسح بعد الاختبار.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { LIVE_DATABASE_URL } from "./live-config.js";
import { PrismaClient } from "@prisma/client";
import type { SemanticStore } from "@agentbridge/memory";
import { createPrismaSemanticStore } from "./prisma-semantic-store.js";
import {
  PREFIX, tenantRecord, projectRecord, specRecord, pipelineRecord,
  certificateRecord, artifactRecord, auditEntry, seedOriginChain,
} from "./semantic-seed.js";
// DATABASE_URL الافتراضي = عنوان docker-compose.dev.yaml (منفذ 5433 غير القياسي)
const DATABASE_URL = process.env.AB_LIVE_DATABASE_URL
  ?? LIVE_DATABASE_URL;

async function probeDatabase(): Promise<boolean> {
  const separator = DATABASE_URL.includes("?") ? "&" : "?";
  const probe = new PrismaClient({ datasources: { db: { url: `${DATABASE_URL}${separator}connect_timeout=2` } } });
  try {
    await probe.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

const available = await probeDatabase();
if (!available) {
  console.info(
    "[تخطٍّ موثق] اختبار PrismaSemanticStore التكاملي: لا قاعدة PostgreSQL حية على العنوان المضبوط — " +
      "أقلع docker-compose.dev.yaml أو اضبط AB_LIVE_DATABASE_URL لتشغيله",
  );
}

describe.skipIf(!available)("PrismaSemanticStore فوق PostgreSQL حي", () => {
  let prisma: PrismaClient;
  let store: SemanticStore;
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    store = createPrismaSemanticStore(prisma);
    tenantA = tenantRecord("a").tenantId;
    tenantB = tenantRecord("b").tenantId;
    await store.createTenant(tenantRecord("a"));
    await store.createTenant(tenantRecord("b"));
  });

  afterAll(async () => {
    // تمحيص كل صفوف الجلسة بترتيب يحترم عدم وجود مفاتيح أجنبية معلنة
    await prisma.auditLog.deleteMany({ where: { tenant_id: { startsWith: PREFIX } } });
    await prisma.artifact.deleteMany({ where: { tenant_id: { startsWith: PREFIX } } });
    await prisma.certificate.deleteMany({ where: { tenant_id: { startsWith: PREFIX } } });
    await prisma.pipeline.deleteMany({ where: { tenant_id: { startsWith: PREFIX } } });
    await prisma.spec.deleteMany({ where: { tenant_id: { startsWith: PREFIX } } });
    await prisma.project.deleteMany({ where: { tenant_id: { startsWith: PREFIX } } });
    await prisma.tenant.deleteMany({ where: { id: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("المستأجر يدور رحاباً والمجهول يعيد null", async () => {
    expect(await store.getTenant(tenantA)).toMatchObject({ tenantId: tenantA, apiKeyHash: "hash-a" });
    expect(await store.getTenant(`${PREFIX}ghost`)).toBeNull();
  });

  it("المشاريع بمساحة مستأجر صارمة", async () => {
    const projectA = projectRecord(tenantA, "1");
    const projectB = projectRecord(tenantB, "2");
    await store.createProject(projectA);
    await store.createProject(projectB);

    expect(await store.getProject(tenantA, projectA.projectId)).toEqual(projectA);
    // B محجوب عن مشروع A والعكس — الانعزال في الاستعلام نفسه لا في الكود المستدعي
    expect(await store.getProject(tenantB, projectA.projectId)).toBeNull();
    expect((await store.listProjects(tenantA)).map((p) => p.projectId)).toEqual([projectA.projectId]);
  });

  it("المواصفة تُستدفع وتُقرأ داخل نطاق مستأجرها حصراً", async () => {
    const project = projectRecord(tenantA, "3");
    await store.createProject(project);
    const spec = specRecord(tenantA, project.projectId, "1");
    await store.createSpec(spec);

    expect(await store.getSpec(tenantA, spec.specId)).toEqual(spec);
    expect(await store.getSpec(tenantB, spec.specId)).toBeNull();
  });

  it("upsertPipeline يحدّث الصف ذاته ولا يضاعفه، والقائمة بنطاق المستأجر", async () => {
    await seedOriginChain(store, tenantA, "4", "1");
    const runId = `${PREFIX}run-1`;
    const record = pipelineRecord(tenantA, `${PREFIX}prj-4`, `${PREFIX}spec-1`, "1");

    await store.upsertPipeline(record);
    await store.upsertPipeline({ ...record, status: "completed", updatedAt: new Date().toISOString() });

    const stored = await store.getPipeline(tenantA, runId);
    expect(stored?.status).toBe("completed");
    expect(await prisma.pipeline.count({ where: { id: runId } })).toBe(1);
    expect((await store.listPipelines(tenantB)).map((r) => r.runId)).not.toContain(runId);
  });

  it("الشهادة تُحفظ وتُقرأ برقم التحقق العالمي عبر الفهرس الفعلي", async () => {
    const runId = `${PREFIX}run-cert`;
    const verificationId = `AB-${runId.slice(PREFIX.length).replaceAll("-", "").padEnd(16, "0").slice(0, 16)}`;
    // FK الحي يلزم: مشروع + مواصفة + تشغيل أصليين قبل الشهادة
    await seedOriginChain(store, tenantA, "cert", "cert");
    const record = certificateRecord(tenantA, runId, verificationId);
    await store.saveCertificate(record);

    expect(await store.getCertificate(tenantA, runId)).toEqual(record);
    expect(await store.getCertificate(tenantB, runId)).toBeNull();
    // الاستثناء العلني الموثق: بحث عالمي بالمفتاح الطبيعي يضرب فهرس verification_id
    expect((await store.getCertificateByVerificationId(verificationId))?.tenantId).toBe(tenantA);
    expect(await store.getCertificateByVerificationId(`AB-${"f".repeat(16)}`)).toBeNull();
    expect((await store.listCertificates(tenantA)).some((c) => c.runId === runId)).toBe(true);
  });

  it("حزمة الخادم تُحفظ وتُستدفع بالمفتاح المركب", async () => {
    const runId = `${PREFIX}run-artifact`;
    // FK الحي يلزم سلسلة الأصل كاملة قبل الحزمة — اللاحقة تحسم runId المطابق
    await seedOriginChain(store, tenantA, "art", "artifact");
    const record = artifactRecord(tenantA, runId);
    await store.saveArtifact(record);

    expect(await store.getArtifact(tenantA, runId)).toEqual(record);
    expect(await store.getArtifact(tenantB, runId)).toBeNull();
  });

  it("سجل التدقيق إلحاق-فقط مرتب بالتسلسل وبانعزال مستأجر كامل", async () => {
    const runId = `${PREFIX}run-audit`;
    await store.appendAuditEntry(auditEntry(tenantA, runId, 1));
    await store.appendAuditEntry(auditEntry(tenantA, runId, 2));

    const last = await store.lastAuditEntry(tenantA);
    expect(last?.seq).toBe(2);
    const listed = await store.listAuditEntries(tenantA);
    expect(listed.map((entry) => entry.seq)).toEqual([...listed.map((entry) => entry.seq)].sort((x, y) => x - y));
    // مستأجر B لا يرى شيئاً من سلسلة A — لا ذاكرة بلا مستأجر
    expect(await store.lastAuditEntry(tenantB)).toBeNull();
    expect(await store.listAuditEntries(tenantB)).toHaveLength(0);
  });
});
