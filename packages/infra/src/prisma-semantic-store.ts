/**
 * محول الذاكرة الدلالية L2 فوق PostgreSQL/Prisma — المنفذ الحي.
 *
 * كل عملية مستأجر تمر عبر معاملة RLS واحدة تضبط app.tenant_id
 * أولاً وتنفذ العمل على TransactionClient نفسه — الصلاحيات على مستوى القاعدة
 * (دور مقيد + سياسات FORCE) لا الوعود على مستوى الكود. الاستثناءان الموثقان:
 * getTenant (مستأجر السياق نفسه) وgetCertificateByVerificationId (منفذ
 * verification ضيق بمفتاح lookup مسموح — لا فتح tenant CRUD عبره).
 * القاعدة الملزمة لجسمه: نداءات delegate رفيعة + مبدئو الصفوف النقية حصراً.
 */

import { PrismaClient, type Prisma } from "@prisma/client";
import type {
  ArtifactRecord,
  CertificateRecord,
  CertificateRevocationRecord,
  PipelineRecord,
  ProjectRecord,
  SemanticStore,
  SpecRecord,
  TenantRecord,
} from "@agentbridge/memory";
import type { AuditTrailEntry } from "@agentbridge/shared";
import {
  artifactFromRow, artifactToRow, auditEntryFromRow, auditEntryToRow,
  certificateFromRow, certificateToRow, pipelineFromRow, pipelineToRow,
  projectFromRow, projectToRow, specFromRow, specToRow, tenantFromRow, tenantToRow,
} from "./row-mappers.js";
import { withLookupPrisma, withTenantPrisma } from "./prisma-scope.js";

export function createPrismaSemanticStore(client: PrismaClient): SemanticStore {
  return {
    // ----- المستأجرون -----
    async createTenant(record: TenantRecord) {
      // إنشاء صف المستأجر نفسه داخل سياقه — سياسة جدول tenants تفرض التطابق
      await withTenantPrisma(client, record.tenantId, (tx) =>
        tx.tenant.create({ data: tenantToRow(record) }));
    },
    async getTenant(tenantId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.tenant.findUnique({ where: { id: tenantId } }));
      return row === null ? null : tenantFromRow(row);
    },

    // ----- المشاريع -----
    async createProject(record: ProjectRecord) {
      await withTenantPrisma(client, record.tenantId, (tx) =>
        tx.project.create({ data: projectToRow(record) }));
    },
    async getProject(tenantId, projectId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.project.findFirst({ where: { id: projectId, tenant_id: tenantId } }));
      return row === null ? null : projectFromRow(row);
    },
    async listProjects(tenantId) {
      const rows = await withTenantPrisma(client, tenantId, (tx) =>
        tx.project.findMany({ where: { tenant_id: tenantId }, orderBy: [{ created_at: "asc" }] }));
      return rows.map(projectFromRow);
    },

    // ----- المواصفات -----
    async createSpec(record: SpecRecord) {
      await withTenantPrisma(client, record.tenantId, (tx) =>
        tx.spec.create({ data: specToRow(record) }));
    },
    async getSpec(tenantId, specId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.spec.findFirst({ where: { id: specId, tenant_id: tenantId } }));
      return row === null ? null : specFromRow(row);
    },

    // ----- التشغيلات -----
    async upsertPipeline(record: PipelineRecord) {
      const row = pipelineToRow(record);
      await withTenantPrisma(client, record.tenantId, (tx) =>
        tx.pipeline.upsert({ where: { id: record.runId }, update: row, create: row }));
    },
    async getPipeline(tenantId, runId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.pipeline.findFirst({ where: { id: runId, tenant_id: tenantId } }));
      return row === null ? null : pipelineFromRow(row);
    },
    async listPipelines(tenantId) {
      const rows = await withTenantPrisma(client, tenantId, (tx) =>
        tx.pipeline.findMany({ where: { tenant_id: tenantId }, orderBy: [{ created_at: "asc" }] }));
      return rows.map(pipelineFromRow);
    },

    // ----- الشهادات -----
    async saveCertificate(record: CertificateRecord) {
      const row = certificateToRow(record);
      await withTenantPrisma(client, record.tenantId, (tx) =>
        tx.certificate.upsert({
          where: { tenant_id_run_id: { tenant_id: record.tenantId, run_id: record.runId } },
          update: row, create: row,
        }));
    },
    async getCertificate(tenantId, runId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.certificate.findUnique({
          where: { tenant_id_run_id: { tenant_id: tenantId, run_id: runId } },
        }));
      return row === null ? null : certificateFromRow(row);
    },
    async listCertificates(tenantId) {
      const rows = await withTenantPrisma(client, tenantId, (tx) =>
        tx.certificate.findMany({ where: { tenant_id: tenantId }, orderBy: [{ issued_at: "asc" }] }));
      return rows.map(certificateFromRow);
    },
    async getCertificateByVerificationId(verificationId) {
      // منفذ pre-auth ضيق: سياسة verification_exact_lookup تطابق
      // الصف بمفتاح lookup مسموح — لا سياق مستأجر ولا فتح tenant CRUD عبره
      const row = await withLookupPrisma(client, [["app.verification_id", verificationId]], (tx) =>
        tx.certificate.findFirst({ where: { verification_id: verificationId } }));
      return row === null ? null : certificateFromRow(row);
    },

    // ----- إبطال الشهادات: إلحاق فقط بلا تحديث ولا حذف -----
    async revokeCertificate(record: CertificateRevocationRecord) {
      await withTenantPrisma(client, record.tenantId, (tx) =>
        tx.certificateRevocation.create({
          data: {
            tenant_id: record.tenantId,
            run_id: record.runId,
            verification_id: record.verificationId,
            reason: record.reason,
            revoked_at: new Date(record.revokedAt),
          },
        }));
    },
    async getRevocationByVerificationId(verificationId) {
      // منفذ pre-auth ضيق ثانٍ بنفس مفتاح lookup الشهادة — سياسة
      // revocation_exact_lookup تتيح قراءة صف الإبطال للتحقق العام حصراً
      const row = await withLookupPrisma(client, [["app.verification_id", verificationId]], (tx) =>
        tx.certificateRevocation.findFirst({ where: { verification_id: verificationId } }));
      return row === null ? null : {
        tenantId: row.tenant_id,
        runId: row.run_id,
        verificationId: row.verification_id,
        reason: row.reason,
        revokedAt: row.revoked_at.toISOString(),
      };
    },

    // ----- حزم الخوادم -----
    async saveArtifact(record: ArtifactRecord) {
      const row = artifactToRow(record);
      await withTenantPrisma(client, record.tenantId, (tx) =>
        tx.artifact.upsert({
          where: { tenant_id_run_id: { tenant_id: record.tenantId, run_id: record.runId } },
          update: row, create: row,
        }));
    },
    async getArtifact(tenantId, runId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.artifact.findUnique({
          where: { tenant_id_run_id: { tenant_id: tenantId, run_id: runId } },
        }));
      return row === null ? null : artifactFromRow(row);
    },

    // ----- سجل التدقيق: إلحاق فقط بترتيب seq داخل نطاق المستأجر -----
    async lastAuditEntry(tenantId) {
      const row = await withTenantPrisma(client, tenantId, (tx) =>
        tx.auditLog.findFirst({ where: { tenant_id: tenantId }, orderBy: [{ seq: "desc" }] }));
      return row === null ? null : auditEntryFromRow(row);
    },
    async appendAuditEntry(entry: AuditTrailEntry) {
      await withTenantPrisma(client, entry.tenantId, (tx) =>
        tx.auditLog.create({ data: auditEntryToRow(entry) }));
    },
    async listAuditEntries(tenantId) {
      const rows = await withTenantPrisma(client, tenantId, (tx) =>
        tx.auditLog.findMany({ where: { tenant_id: tenantId }, orderBy: [{ seq: "asc" }] }));
      return rows.map(auditEntryFromRow);
    },
  };
}

/** قراءة ذيل سلسلة التدقيق على عميل معاملة قائمة — لوصل داخل المعاملة */
export async function lastAuditEntryWithTx(tx: Prisma.TransactionClient, tenantId: string): Promise<AuditTrailEntry | null> {
  const row = await tx.auditLog.findFirst({ where: { tenant_id: tenantId }, orderBy: [{ seq: "desc" }] });
  return row === null ? null : auditEntryFromRow(row);
}

/** إلحاق صف تدقيق على عميل معاملة قائمة — يكتب ضمن نفس الذرية حصراً */
export async function appendAuditEntryWithTx(tx: Prisma.TransactionClient, entry: AuditTrailEntry): Promise<void> {
  await tx.auditLog.create({ data: auditEntryToRow(entry) });
}
