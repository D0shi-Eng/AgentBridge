/**
 * مبدئو صفوف L2 — الدوال النقية الوحيدة للمحول فوق Prisma.
 *
 * PrismaClient الفعلي يتأجل حتى تجهز قاعدة حية؛ هذه الدوال تختبر الآن
 * بالكامل: تحويل السجلات النطاقية ↔ صفوف الجداول بsnake_case وتحويل
 * زمن ISO ↔ Date. حين يُوصَّل العميل يصبح جسمه delegate + هذه المبدئوات.
 * LlmSpend و Audit و Embedding و Flywheel و SSO منقولون لوحداتهما
 * لضمان بقاء هذا الملف ≤200 سطر. يعيد تصدير المبدئين الأساسيين من base-mappers.
 */

import type { ArtifactRecord, CertificateRecord, PipelineRecord } from "@agentbridge/memory";

// إعادة تصدير المبدئين المنقولين للتوافق الخلفي — المستوردات القديمة تبقى خضراء
export { auditEntryFromRow, auditEntryToRow, type AuditTrailRow } from "./audit-mappers.js";
export { currentMonthKey, type LlmSpendRow } from "./billing-mappers.js";
export {
  cosineDistance,
  EMBEDDING_DIMS_L3,
  embeddingFromRow,
  embeddingToRow,
  type MemoryEmbeddingRow,
} from "./embedding-mappers.js";
export { lessonFromRow, lessonToRow, type FlywheelLessonRow } from "./flywheel-mappers.js";
export { ssoCreateRow, ssoUpdateRow, ssoFromRow, type SsoConfigRow } from "./sso-mappers.js";

// إعادة تصدير المبدئين الأساسيين من base-mappers
export { tenantToRow, tenantFromRow, type TenantRow } from "./base-mappers.js";
export { projectToRow, projectFromRow, type ProjectRow } from "./base-mappers.js";
export { specToRow, specFromRow, type SpecRow } from "./base-mappers.js";

export interface PipelineRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly spec_id: string;
  readonly status: string;
  readonly stopped_at: string | null;
  readonly repair_cycles_used: number;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export function pipelineToRow(record: PipelineRecord): PipelineRow {
  return {
    id: record.runId,
    tenant_id: record.tenantId,
    project_id: record.projectId,
    spec_id: record.specId,
    status: record.status,
    stopped_at: record.stoppedAt ?? null,
    repair_cycles_used: record.repairCyclesUsed,
    created_at: new Date(record.createdAt),
    updated_at: new Date(record.updatedAt),
  };
}

export function pipelineFromRow(row: PipelineRow): PipelineRecord {
  return {
    runId: row.id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    specId: row.spec_id,
    status: row.status,
    ...(row.stopped_at !== null ? { stoppedAt: row.stopped_at } : {}),
    repairCyclesUsed: row.repair_cycles_used,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export interface CertificateRow {
  readonly run_id: string;
  readonly tenant_id: string;
  readonly final_score: number;
  readonly granted: boolean;
  readonly verification_id: string;
  readonly certificate_json: string;
  readonly issued_at: Date;
}

export function certificateToRow(record: CertificateRecord): CertificateRow {
  return {
    run_id: record.runId,
    tenant_id: record.tenantId,
    final_score: record.finalScore,
    granted: record.granted,
    verification_id: record.verificationId,
    certificate_json: record.certificateJson,
    issued_at: new Date(record.issuedAt),
  };
}

export function certificateFromRow(row: CertificateRow): CertificateRecord {
  return {
    runId: row.run_id,
    tenantId: row.tenant_id,
    finalScore: row.final_score,
    granted: row.granted,
    verificationId: row.verification_id,
    certificateJson: row.certificate_json,
    issuedAt: row.issued_at.toISOString(),
  };
}

export interface ArtifactRow {
  readonly run_id: string;
  readonly tenant_id: string;
  readonly artifact_json: string;
  readonly created_at: Date;
}

export function artifactToRow(record: ArtifactRecord): ArtifactRow {
  return { run_id: record.runId, tenant_id: record.tenantId, artifact_json: record.artifactJson, created_at: new Date(record.createdAt) };
}

export function artifactFromRow(row: ArtifactRow): ArtifactRecord {
  return { runId: row.run_id, tenantId: row.tenant_id, artifactJson: row.artifact_json, createdAt: row.created_at.toISOString() };
}