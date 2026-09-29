/**
 * محول L3 الحي — ينفذ VectorStore فوق pgvector بـ SQL خام عبر Prisma.
 *
 * ماهيته: ترجمة VectorDocument ↔ صفوف memory_embeddings بلا منطق نطاق — كل تحويل
 * نقي في embedding-mappers (embeddingToRow/FromRow + cosineDistance).
 * وظيفته: يخزن متجهات 1536 بُعداً ويبحث بجيب تمام داخل مستأجر واحد حصراً.
 * كيف: كل عملية تفتح معاملة RLS تضبط app.tenant_id أولاً
 * وتنفذ SQL الخام على TransactionClient نفسه — عميل الجذر لا يلمس الجدول.
 */

import type { PrismaClient } from "@prisma/client";
import type { VectorDocument, VectorHit, VectorNamespace, VectorStore } from "@agentbridge/memory";
import { embeddingToRow } from "./embedding-mappers.js";
import { requireTenantContext } from "@agentbridge/shared";
import { withTenantPrisma } from "./prisma-scope.js";

// استخدام Prisma الخام داخل معاملة المستأجر — نمرر السلسلة ونترك التحويل للمبدئين
export function createPgVectorStore(prisma: PrismaClient): VectorStore {
  return {
    async upsert(context, document: VectorDocument): Promise<void> {
      const trusted = requireTenantContext(context);
      if (document.tenantId !== trusted.tenantId) throw new Error("tenantId في المتجه لا يطابق السياق الموثوق");
      // نعيد استخدام المبدئ النقي لبناء الصف، لكن run_id هو namespace والchunk هو JSON للـmetadata
      const row = embeddingToRow({
        id: document.id,
        tenantId: document.tenantId,
        runId: document.namespace,
        chunk: JSON.stringify(document.metadata),
        embedding: document.vector as number[],
      });
      const vectorLiteral = row.embedding;
      await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "memory_embeddings" ("id","tenant_id","run_id","chunk","embedding","created_at") VALUES ($1,$2,$3,$4,$5::vector,$6) ON CONFLICT ("tenant_id","run_id","id") DO UPDATE SET "chunk"=EXCLUDED."chunk","embedding"=EXCLUDED."embedding"`,
          row.id,
          row.tenant_id,
          row.run_id,
          row.chunk,
          vectorLiteral,
          row.created_at,
        ));
    },

    async remove(context, namespace: VectorNamespace, id: string): Promise<void> {
      const trusted = requireTenantContext(context);
      await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
        tx.$executeRawUnsafe(
          `DELETE FROM "memory_embeddings" WHERE "id"=$1 AND "tenant_id"=$2 AND "run_id"=$3`,
          id,
          trusted.tenantId,
          namespace,
        ));
    },

    async search(context, namespace: VectorNamespace, queryVector: readonly number[], topK: number): Promise<VectorHit[]> {
      const trusted = requireTenantContext(context);
      if (queryVector.length === 0 || topK <= 0) return [];
      const literal = `[${[...queryVector].join(",")}]`;
      // المسافة <=> هي cosine distance؛ الدرجة = 1 - مسافة — داخل معاملة المستأجر
      const rows = await withTenantPrisma(prisma, trusted.tenantId, (tx) =>
        tx.$queryRawUnsafe<Array<{ id: string; chunk: string; score: number }>>(
          `SELECT "id","chunk",(1 - ("embedding" <=> $1::vector)) as score FROM "memory_embeddings" WHERE "tenant_id"=$2 AND "run_id"=$3 ORDER BY "embedding" <=> $1::vector ASC LIMIT $4`,
          literal,
          trusted.tenantId,
          namespace,
          Math.floor(topK),
        ));

      return rows.map((row) => {
        let metadata: Record<string, string> = {};
        try {
          const parsed = JSON.parse(row.chunk) as Record<string, string>;
          if (typeof parsed === "object" && parsed !== null) metadata = parsed;
        } catch {
          // chunk غير JSON — يبقى فارغاً
        }
        return { id: row.id, score: Number(row.score) , metadata };
      });
    },
  };
}

/** دالة مساعدة للاختبارات: هل pgvector حي فعلاً؟ */
export async function isPgVectorAvailable(prisma: PrismaClient): Promise<boolean> {
  try {
    await prisma.$queryRawUnsafe(`SELECT 1 FROM pg_extension WHERE extname='vector'`);
    // محاولة إنشاء متجه تجريبي للتأكد من النوع
    await prisma.$queryRawUnsafe(`SELECT '[0,0,0]'::vector`);
    return true;
  } catch {
    return false;
  }
}
