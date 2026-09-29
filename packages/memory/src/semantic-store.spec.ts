/**
 * اختبارات الذاكرة الدلالية L2 — الانعزال البنيوي للمستأجرين وسلوك الحوض.
 */
import { describe, expect, it } from "vitest";
import { createInMemorySemanticStore, type PipelineRecord } from "./semantic-store.js";

function projectOf(tenantId: string, projectId: string) {
  return { projectId, tenantId, name: `مشروع ${projectId}`, createdAt: "2026-08-24T00:00:00Z" };
}

function pipelineOf(tenantId: string, runId: string): PipelineRecord {
  return {
    runId,
    tenantId,
    projectId: "p1",
    specId: "s1",
    status: "running",
    repairCyclesUsed: 0,
    createdAt: "2026-08-24T00:00:00Z",
    updatedAt: "2026-08-24T00:00:00Z",
  };
}

describe("createInMemorySemanticStore", () => {
  it("المشاريع والمواصفات معزولة بمستأجرها — B لا يرى شيئاً من A", async () => {
    const store = createInMemorySemanticStore();
    await store.createProject(projectOf("tenant-a", "p1"));
    await store.createSpec({ specId: "s1", tenantId: "tenant-a", projectId: "p1", content: "openapi: ...", createdAt: "t" });

    expect(await store.getProject("tenant-a", "p1")).not.toBeNull();
    expect(await store.getProject("tenant-b", "p1")).toBeNull();
    expect(await store.getSpec("tenant-b", "s1")).toBeNull();
    expect((await store.listProjects("tenant-b")).length).toBe(0);
    expect((await store.listProjects("tenant-a")).length).toBe(1);
  });

  it("التشغيلات upsert تحدّث الحالة دون تكرار الصفوف", async () => {
    const store = createInMemorySemanticStore();
    await store.upsertPipeline(pipelineOf("tenant-a", "r1"));
    await store.upsertPipeline({ ...pipelineOf("tenant-a", "r1"), status: "completed" });
    await store.upsertPipeline(pipelineOf("tenant-a", "r2"));

    const record = await store.getPipeline("tenant-a", "r1");
    expect(record?.status).toBe("completed");
    expect(await store.getPipeline("tenant-b", "r1")).toBeNull();
    expect((await store.getPipeline("tenant-a", "r2"))?.runId).toBe("r2");

    // قائمة التشغيلات معزولة بالمستأجر حصراً
    const owned = await store.listPipelines("tenant-a");
    expect(owned).toHaveLength(2);
    expect(owned.every((entry) => entry.tenantId === "tenant-a")).toBe(true);
    expect(await store.listPipelines("tenant-b")).toHaveLength(0);
  });

  it("حزم الخادم المولدة تُحفظ وتُجلب بنطاق مستأجر مزدوج", async () => {
    const store = createInMemorySemanticStore();
    await store.saveArtifact({
      runId: "r1",
      tenantId: "tenant-a",
      artifactJson: '{"files":[],"toolNames":[]}',
      createdAt: "2026-08-25T00:00:00Z",
    });
    expect((await store.getArtifact("tenant-a", "r1"))?.runId).toBe("r1");
    expect(await store.getArtifact("tenant-b", "r1")).toBeNull();
    expect(await store.getArtifact("tenant-a", "r404")).toBeNull();
  });

  it("الشهادات تعزل بالمستأجر وتحفظ نص الشهادة كاملاً", async () => {
    const store = createInMemorySemanticStore();
    const certificate = { finalScore: 96, granted: true, verificationId: "AB-1234", certificateJson: "{}", issuedAt: "t" };
    await store.saveCertificate({ runId: "r1", tenantId: "tenant-a", ...certificate });

    expect((await store.getCertificate("tenant-a", "r1"))?.finalScore).toBe(96);
    expect(await store.getCertificate("tenant-b", "r1")).toBeNull();
  });

  it("listCertificates تعزل بالمستأجر وتجلب الكل فقط لنطاقه", async () => {
    const store = createInMemorySemanticStore();
    await store.saveCertificate({
      runId: "r1", tenantId: "tenant-a", finalScore: 96, granted: true, verificationId: "AB-aaa1", certificateJson: "{}", issuedAt: "t",
    });
    await store.saveCertificate({
      runId: "r2", tenantId: "tenant-a", finalScore: 40, granted: false, verificationId: "AB-aaa2", certificateJson: "{}", issuedAt: "t",
    });
    await store.saveCertificate({
      runId: "r9", tenantId: "tenant-b", finalScore: 90, granted: true, verificationId: "AB-bbb1", certificateJson: "{}", issuedAt: "t",
    });
    const owned = await store.listCertificates("tenant-a");
    expect(owned).toHaveLength(2);
    expect(owned.every((record) => record.tenantId === "tenant-a")).toBe(true);
    expect(await store.listCertificates("tenant-c")).toHaveLength(0);
  });

  it("البحث العام برقم التحقق يعبر المستأجرين عمداً — سطح صفحة /verify", async () => {
    const store = createInMemorySemanticStore();
    const record = {
      runId: "r1", tenantId: "tenant-a", finalScore: 96, granted: true,
      verificationId: "AB-abcdef0123456789", certificateJson: `{"artifactsHash":"${"f".repeat(64)}"}`, issuedAt: "t",
    };
    await store.saveCertificate(record);

    const found = await store.getCertificateByVerificationId("AB-abcdef0123456789");
    expect(found?.runId).toBe("r1");
    expect(await store.getCertificateByVerificationId("AB-0000000000000000")).toBeNull();
    // التحديث بإعادة الحفظ يحدّث الفهرس لا أن يكرره
    await store.saveCertificate({ ...record, finalScore: 97 });
    expect((await store.getCertificateByVerificationId("AB-abcdef0123456789"))?.finalScore).toBe(97);
  });

  it("المستأجرون يُنشأون ويُجلبون بالمفتاح الطبيعي (للمصادقة فقط)", async () => {
    const store = createInMemorySemanticStore();
    await store.createTenant({ tenantId: "tenant-a", name: "عيادات النور", apiKeyHash: "scrypt$x$y$z", createdAt: "t" });
    expect((await store.getTenant("tenant-a"))?.name).toBe("عيادات النور");
    expect(await store.getTenant("nope")).toBeNull();
  });

  it("حوض التدقيق: إلحاق بترتيب الوصول وآخر صف لكل مستأجر على حدة", async () => {
    const store = createInMemorySemanticStore();
    const entry = (seq: number, hash: string) => ({
      seq,
      tenantId: "tenant-a",
      runId: "r1",
      stage: "load_spec" as const,
      decision: "completed",
      abstractedPayload: "x",
      at: "2026-08-24T00:00:00Z",
      prevHash: "0".repeat(64),
      hash,
    });
    await store.appendAuditEntry(entry(1, "a".repeat(64)));
    await store.appendAuditEntry(entry(2, "b".repeat(64)));
    expect((await store.lastAuditEntry("tenant-a"))?.hash).toBe("b".repeat(64));
    expect((await store.listAuditEntries("tenant-a")).length).toBe(2);
    expect(await store.lastAuditEntry("tenant-b")).toBeNull();
  });
});
