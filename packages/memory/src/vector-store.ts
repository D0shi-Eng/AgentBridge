/**
 * الذاكرة المتجهية L3 — منفذ VectorStore ومحوله داخل الذاكرة (وثيقة memory.md §L3).
 *
 * تخزن الطبقة تمثيلات دلالية فقط: متجهات + بيانات وصفية قصيرة —
 * لا نص خام حساس أبداً (قاعدة 2 في وثيقة 07). التضمين هنا حتمي
 * (hash كيس-الكلمات FNV-1a) بلا شبكة ولا نموذج؛ مزود embeddings
 * الحقيقي ومحول pgvector SQL مؤجلان موثقين في Backlog — ممنوع
 * تضمينات مزيفة تنتظر شبكة.
 *
 * البحث دائماً داخل نطاق مستأجر واحد ومساحة واحدة — الانعزال فرض
 * على مستوى المنفذ نفسه.
 */

import { Errors, requireTenantContext, type TenantContext } from "@agentbridge/shared";

/** أبعاد المتجهات الحتمية — ثابتة حتى قدوم مزود embeddings حقيقي */
export const EMBEDDING_DIMS = 64;

/** إصدار خوارزمية التضمين الحتمية — مفتاح إلزامي في metadata لكل وثيقة */
export const EMBEDDING_VERSION = "fnv64-v1";

/** مفاتيح provenance الإلزامية في metadata — upsert بلاها مرفوض */
export const VECTOR_PROVENANCE_KEYS = ["embeddingVersion", "provenance"] as const;

export type VectorNamespace = "spec" | "tool" | "failure";

export interface VectorDocument {
  readonly id: string;
  readonly tenantId: string;
  readonly namespace: VectorNamespace;
  readonly vector: readonly number[];
  /** بيانات وصفية قصيرة فقط (معرفات وعناوين) — بلا نص خام */
  readonly metadata: Readonly<Record<string, string>>;
}

export interface VectorHit {
  readonly id: string;
  readonly score: number;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface VectorStore {
  upsert(context: TenantContext, document: VectorDocument): Promise<void>;
  remove(context: TenantContext, namespace: VectorNamespace, id: string): Promise<void>;
  /** أعلى topK تطابقاً داخل نطاق المستأجر والمساحة، تنازلياً بالدرجة */
  search(
    context: TenantContext,
    namespace: VectorNamespace,
    queryVector: readonly number[],
    topK: number,
  ): Promise<VectorHit[]>;
}

/** تجزئة FNV-1a بحجم 32 بت — حتمية عبر المنصات ولا تحتاج crypto */
function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** تضمين حتمي كيس-الكلمات مطبّع L2 — نفس النص = نفس المتجه بايت ببايت */
export function embedText(text: string): number[] {
  const counts = new Array<number>(EMBEDDING_DIMS).fill(0);
  for (const token of text.toLowerCase().split(/[^a-z0-9\u0600-\u06ff]+/u)) {
    if (token.length === 0) continue;
    const bucket = fnv1a(token) % EMBEDDING_DIMS;
    counts[bucket] = (counts[bucket] ?? 0) + 1;
  }
  const norm = Math.sqrt(counts.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return counts;
  return counts.map((value) => value / norm);
}

/** جيب تمام بين متجهين — صفر إذا اختلفت الأبعاد أو انعدمت القيمة */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let index = 0; index < a.length; index += 1) {
    dot += (a[index] ?? 0) * (b[index] ?? 0);
    normA += (a[index] ?? 0) ** 2;
    normB += (b[index] ?? 0) ** 2;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** محول داخل الذاكرة — فهرسة بمفتاح `tenant:namespace:id` */
export function createInMemoryVectorStore(): VectorStore {
  const documents = new Map<string, VectorDocument>();

  function validate(document: VectorDocument): void {
    if (document.vector.length !== EMBEDDING_DIMS) {
      throw Errors.invalidInput(`طول المتجه ${document.vector.length} يخالف الأبعاد المعتمدة ${EMBEDDING_DIMS}`);
    }
    // provenance إلزامي: لا وثيقة بلا إصدار تضمين ومنشأ معلن —
    // منع خلط أجيال الفهرسة ودخول سجلات مجهولة المصدر
    for (const key of VECTOR_PROVENANCE_KEYS) {
      if (typeof document.metadata[key] !== "string" || document.metadata[key].length === 0) {
        throw Errors.invalidInput(`metadata يغيب المفتاح الإلزامي «${key}» — لا دخول بلا provenance`);
      }
    }
    for (const [key, value] of Object.entries(document.metadata)) {
      if (value.length > 200) {
        throw Errors.invalidInput(`بيانات وصفية أطول من الحد عند «${key}» — لا نص خام في L3`);
      }
    }
  }

  return {
    async upsert(context, document) {
      const trusted = requireTenantContext(context);
      if (document.tenantId !== trusted.tenantId) throw Errors.invalidInput("tenantId في المتجه لا يطابق السياق الموثوق");
      validate(document);
      documents.set(JSON.stringify([trusted.tenantId, document.namespace, document.id]), document);
    },

    async remove(context, namespace, id) {
      const trusted = requireTenantContext(context);
      documents.delete(JSON.stringify([trusted.tenantId, namespace, id]));
    },

    async search(context, namespace, queryVector, topK) {
      const trusted = requireTenantContext(context);
      if (queryVector.length !== EMBEDDING_DIMS || topK <= 0) return [];
      const hits: VectorHit[] = [];
      for (const document of documents.values()) {
        if (document.tenantId !== trusted.tenantId || document.namespace !== namespace) continue;
        hits.push({ id: document.id, score: cosine(queryVector, document.vector), metadata: document.metadata });
      }
      return hits.sort((a, b) => b.score - a.score).slice(0, Math.floor(topK));
    },
  };
}
