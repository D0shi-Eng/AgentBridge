/**
 * مبدئو الصفوف الأساسية L2 — الدوال النقية للمستأجرين والمشاريع والمواصفات.
 *
 * تم فصلها من row-mappers.ts لتبقي كل ملف ≤200 سطر.
 * PrismaClient الفعلي يتأجل حتى تجهز قاعدة حية؛ هذه الدوال تختبر الآن
 * بالكامل: تحويل السجلات النطاقية ↔ صفوف الجداول بsnake_case وتحويل
 * زمن ISO ↔ Date.
 */

import type { ProjectRecord, SpecRecord, TenantRecord } from "@agentbridge/memory";

export interface TenantRow {
  readonly id: string;
  readonly name: string;
  readonly api_key_hash: string;
  readonly is_admin: boolean;
  readonly created_at: Date;
  /** FC — قبر المستأجر بعد الحذف؛ null = مستأجر حي */
  readonly deleted_at: Date | null;
  /** FC — حجز قانوني نافذ حتى هذا التوقيت؛ null = لا حجز */
  readonly legal_hold_until: Date | null;
}

export function tenantToRow(record: TenantRecord): TenantRow {
  return {
    id: record.tenantId, name: record.name, api_key_hash: record.apiKeyHash, is_admin: record.isAdmin ?? false,
    created_at: new Date(record.createdAt),
    deleted_at: record.deletedAt === undefined ? null : new Date(record.deletedAt),
    legal_hold_until: record.legalHoldUntil === undefined ? null : new Date(record.legalHoldUntil),
  };
}

export function tenantFromRow(row: TenantRow): TenantRecord {
  return {
    tenantId: row.id, name: row.name, apiKeyHash: row.api_key_hash, isAdmin: row.is_admin, createdAt: row.created_at.toISOString(),
    ...(row.deleted_at === null ? {} : { deletedAt: row.deleted_at.toISOString() }),
    ...(row.legal_hold_until === null ? {} : { legalHoldUntil: row.legal_hold_until.toISOString() }),
  };
}

export interface ProjectRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly name: string;
  readonly created_at: Date;
}

export function projectToRow(record: ProjectRecord): ProjectRow {
  return { id: record.projectId, tenant_id: record.tenantId, name: record.name, created_at: new Date(record.createdAt) };
}

export function projectFromRow(row: ProjectRow): ProjectRecord {
  return { projectId: row.id, tenantId: row.tenant_id, name: row.name, createdAt: row.created_at.toISOString() };
}

export interface SpecRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly project_id: string;
  readonly content: string;
  readonly created_at: Date;
}

export function specToRow(record: SpecRecord): SpecRow {
  return { id: record.specId, tenant_id: record.tenantId, project_id: record.projectId, content: record.content, created_at: new Date(record.createdAt) };
}

export function specFromRow(row: SpecRow): SpecRecord {
  return { specId: row.id, tenantId: row.tenant_id, projectId: row.project_id, content: row.content, createdAt: row.created_at.toISOString() };
}