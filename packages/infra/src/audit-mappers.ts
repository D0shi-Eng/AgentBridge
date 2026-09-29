/**
 * مبدئو صفوف سجل التدقيق — دوال نقية لصفوف audit_log.
 *
 * ماهيتها: تحويل AuditTrailEntry ↔ AuditTrailRow بزمن ISO↔Date وأسماء snake_case
 * مطابقة للقاعدة — لا منطق نطاق، فقط ترجمة شكلية.
 * وظيفتها: يستخدمها HashChainAuditLog ومحولات Prisma بلا أي تحويل داخل المحول.
 * كيف: دوال نقية حتمية تُختبر بدورة كاملة entry→row→entry بلا فقدان.
 */

import type { AuditTrailEntry } from "@agentbridge/shared";

/** صف audit_log — أعمدة snake_case كما في القاعدة، والزمن كتاريخ */
export interface AuditTrailRow {
  readonly seq: number;
  readonly tenant_id: string;
  readonly run_id: string;
  readonly stage: string;
  readonly decision: string;
  readonly abstracted_payload: string;
  readonly at: Date;
  readonly prev_hash: string;
  readonly hash: string;
}

export function auditEntryToRow(entry: AuditTrailEntry): AuditTrailRow {
  return {
    seq: entry.seq,
    tenant_id: entry.tenantId,
    run_id: entry.runId,
    stage: entry.stage,
    decision: entry.decision,
    abstracted_payload: entry.abstractedPayload,
    at: new Date(entry.at),
    prev_hash: entry.prevHash,
    hash: entry.hash,
  };
}

export function auditEntryFromRow(row: AuditTrailRow): AuditTrailEntry {
  const entry: AuditTrailEntry = {
    seq: row.seq,
    tenantId: row.tenant_id,
    runId: row.run_id,
    stage: row.stage as AuditTrailEntry["stage"],
    decision: row.decision,
    abstractedPayload: row.abstracted_payload,
    at: row.at.toISOString(),
    prevHash: row.prev_hash,
    hash: row.hash,
  };
  return entry;
}
