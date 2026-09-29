/**
 * مبدئو صفوف L3 المتجهية — تحويل المتجهات ↔ صفوف pgvector.
 *
 * ماهيتها: دوال نقية لترجمة VectorDocument ↔ MemoryEmbeddingRow ولحساب
 * مسافة جيب التمام حتمياً — لا منطق نطاق في المحول، كل التحويل هنا.
 * وظيفتها: يغذي PgVectorStore وEmbeddingsProvider دون تضمينات مزيفة.
 * كيف: embeddingToRow يحول vector(1536) إلى نص pgvector؛ FromRow يعكس؛
 * cosineDistance تحسب 1 - cosine (لترتيب pgvector).
 */

/** أبعاد التضمين المعتمدة لـ text-embedding-3-small */
export const EMBEDDING_DIMS_L3 = 1536;

export interface MemoryEmbeddingRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly run_id: string;
  readonly chunk: string;
  readonly embedding: string;
  readonly created_at: Date;
}

export function embeddingToRow(params: {
  id: string;
  tenantId: string;
  runId: string;
  chunk: string;
  embedding: readonly number[];
}): MemoryEmbeddingRow {
  if (params.embedding.length !== EMBEDDING_DIMS_L3) {
    throw new Error(`طول التضمين ${params.embedding.length} يخالف ${EMBEDDING_DIMS_L3}`);
  }
  return {
    id: params.id,
    tenant_id: params.tenantId,
    run_id: params.runId,
    chunk: params.chunk,
    embedding: `[${params.embedding.join(",")}]`,
    created_at: new Date(),
  };
}

export function embeddingFromRow(row: MemoryEmbeddingRow): {
  id: string;
  tenantId: string;
  runId: string;
  chunk: string;
  embedding: number[];
  createdAt: string;
} {
  const raw = row.embedding.trim().replace(/^\[/u, "").replace(/\]$/u, "");
  const embedding = raw.length === 0 ? [] : raw.split(",").map((part) => Number(part.trim()));
  return {
    id: row.id,
    tenantId: row.tenant_id,
    runId: row.run_id,
    chunk: row.chunk,
    embedding,
    createdAt: row.created_at.toISOString(),
  };
}

/** مسافة جيب التمام الحتمية — 0 للمتطابق و2 للمتعاكس تماماً */
export function cosineDistance(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 1;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += (a[index] ?? 0) * (b[index] ?? 0);
    normA += (a[index] ?? 0) ** 2;
    normB += (b[index] ?? 0) ** 2;
  }
  if (normA === 0 || normB === 0) return 1;
  return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
