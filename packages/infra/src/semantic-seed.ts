/**
 * مولدات سجلات اختبار PrismaSemanticStore — دوال نقية حصراً (تجزئة ≤150 سطراً).
 * كل مولد يبني سجلاً نطاقياً كاملاً تحت بادئة الجلسة فلا تلوث للقاعدة الحية.
 */
import { randomUUID } from "node:crypto";
import type {
  ArtifactRecord, CertificateRecord, PipelineRecord, ProjectRecord,
  SpecRecord, TenantRecord,
} from "@agentbridge/memory";
import type { AuditTrailEntry } from "@agentbridge/shared";

/** بادئة مستأجري هذه الجلسة فقط — تمحيص كامل بعدها فلا تلوث للقاعدة */
export const PREFIX = `it-${randomUUID().slice(0, 8)}-`;

export function tenantRecord(suffix: string): TenantRecord {
  return { tenantId: `${PREFIX}${suffix}`, name: `مستأجر ${suffix}`, apiKeyHash: `hash-${suffix}`, createdAt: new Date().toISOString() };
}

export function projectRecord(tenantId: string, suffix: string): ProjectRecord {
  return { projectId: `${PREFIX}prj-${suffix}`, tenantId, name: `مشروع ${suffix}`, createdAt: new Date().toISOString() };
}

export function specRecord(tenantId: string, projectId: string, suffix: string): SpecRecord {
  return {
    specId: `${PREFIX}spec-${suffix}`, tenantId, projectId,
    content: "openapi: 3.0.0\ninfo:\n  title: اختبار\n", createdAt: new Date().toISOString(),
  };
}

export function pipelineRecord(tenantId: string, projectId: string, specId: string, suffix: string): PipelineRecord {
  const nowIso = new Date().toISOString();
  return {
    runId: `${PREFIX}run-${suffix}`, tenantId, projectId, specId,
    status: "running", repairCyclesUsed: 0, createdAt: nowIso, updatedAt: nowIso,
  };
}

export function certificateRecord(tenantId: string, runId: string, verificationId: string): CertificateRecord {
  return {
    runId, tenantId, finalScore: 98, granted: true, verificationId,
    certificateJson: JSON.stringify({ verificationId, finalScore: 98 }), issuedAt: new Date().toISOString(),
  };
}

export function artifactRecord(tenantId: string, runId: string): ArtifactRecord {
  return {
    runId, tenantId,
    artifactJson: JSON.stringify({ files: [{ path: "server.ts", contents: "// مولد" }], toolNames: ["t1"] }),
    createdAt: new Date().toISOString(),
  };
}

export function auditEntry(tenantId: string, runId: string, seq: number): AuditTrailEntry {
  return {
    seq, tenantId, runId, stage: "load_spec", decision: "completed",
    abstractedPayload: `حدث ${seq}`, at: new Date().toISOString(), prevHash: "0".repeat(64),
    // hash المفتاح الأساسي عالمياً — يشتق من التسلسل حتى لا تتصادم صفوف التجربة
    hash: `${seq}`.padStart(64, "a"),
  };
}

/** بذر سلسلة أصل كاملة (مشروع + مواصفة + تشغيل) يلزمها FK للشهادة/الحزمة */
export async function seedOriginChain(
  store: { createProject(record: ProjectRecord): Promise<void>; createSpec(record: SpecRecord): Promise<void>; upsertPipeline(record: PipelineRecord): Promise<void> },
  tenantId: string, suffix: string, runSuffix: string,
): Promise<void> {
  const project = projectRecord(tenantId, suffix);
  await store.createProject(project);
  const spec = specRecord(tenantId, project.projectId, suffix);
  await store.createSpec(spec);
  await store.upsertPipeline(pipelineRecord(tenantId, project.projectId, spec.specId, runSuffix));
}
