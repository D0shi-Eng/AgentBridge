/**
 * اختبارات محول pgvector — مشروطة بتوفر Postgres+pgvector الحي.
 *
 * تتخطى نفسها موثقة عند غياب البنية بلا كسر CI، كما تُختبر الدوال النقية
 * في embedding-mappers في كل الحالات.
 */

import { describe, it, expect } from "vitest";
import { LIVE_DATABASE_URL } from "./live-config.js";
import { PrismaClient } from "@prisma/client";
import { cosineDistance, embeddingFromRow, embeddingToRow } from "./embedding-mappers.js";
import type { TenantContext } from "@agentbridge/shared";

function tenantContext(tenantId: string): TenantContext {
  return {
    tenantId,
    principal: {
      actorType: "service", authMethod: "api_key", subjectId: "integration-test",
      tenantId, credentialId: "integration-test", authorizationVersion: 1,
      permissions: ["resource:read", "flywheel:read", "flywheel:write"],
    },
  };
}

// دوال نقية تُختبر دائماً (لا تحتاج قاعدة)
describe("مبدئو التضمين الحتميون", () => {
  it("embeddingToRow يرفض طولاً غير 1536", () => {
    expect(() => embeddingToRow({ id: "a", tenantId: "t", runId: "spec", chunk: "x", embedding: [0, 1] })).toThrow();
  });

  it("دورة كاملة 1536 بُعداً تحفظ المعرف والمستأجر", () => {
    const vec = Array.from({ length: 1536 }, (_, i) => (i % 2 === 0 ? 0.5 : -0.5));
    const row = embeddingToRow({ id: "doc1", tenantId: "t1", runId: "spec", chunk: '{"k":"v"}', embedding: vec });
    expect(row.tenant_id).toBe("t1");
    const restored = embeddingFromRow(row);
    expect(restored.id).toBe("doc1");
    expect(restored.embedding.length).toBe(1536);
    expect(restored.embedding[0]).toBeCloseTo(0.5);
  });

  it("cosineDistance: متطابق=0 ومتعاكس≈2", () => {
    const a = [1, 0, 0];
    const b = [1, 0, 0];
    const c = [-1, 0, 0];
    expect(cosineDistance(a, b)).toBeCloseTo(0);
    expect(cosineDistance(a, c)).toBeCloseTo(2);
  });
});

// تكامل حي مشروط — AB_LIVE (لا قاعدة
// live فقط بلا تخطٍّ صامت في الشوط الحي.
const databaseUrl = process.env.AB_LIVE_DATABASE_URL
  ?? process.env["DATABASE_URL"]
  ?? LIVE_DATABASE_URL;
const isLive = true;

async function checkAvailable(): Promise<boolean> {
  if (!isLive) return false;
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    await prisma.$queryRawUnsafe(`SELECT 1`);
    await prisma.$queryRawUnsafe(`SELECT 1 FROM pg_extension WHERE extname='vector'`);
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

const available = await checkAvailable();
if (!available) console.info("[تخطٍّ موثق] pgvector-store — لا توجد قاعدة حية بامتداد vector — تُتخطى اختبارات التكامل");

describe.skipIf(!available)("PgVectorStore الحي", () => {
  it("upsert + search + remove داخل نفس المستأجر والمساحة", async () => {
    const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const { createPgVectorStore } = await import("./pgvector-store.js");
    const store = createPgVectorStore(prisma);
    const tenant = `t-${Date.now()}`;
    const context = tenantContext(tenant);
    const vecA = Array.from({ length: 1536 }, () => Math.random());
    const normA = Math.sqrt(vecA.reduce((s, v) => s + v * v, 0));
    const normalizedA = vecA.map((v) => v / normA);
    const vecB = Array.from({ length: 1536 }, () => Math.random());
    const normB = Math.sqrt(vecB.reduce((s, v) => s + v * v, 0));
    const normalizedB = vecB.map((v) => v / normB);

    await store.upsert(context, { id: "docA", tenantId: tenant, namespace: "spec", vector: normalizedA, metadata: { tag: "a" } });
    await store.upsert(context, { id: "docB", tenantId: tenant, namespace: "spec", vector: normalizedB, metadata: { tag: "b" } });

    const hits = await store.search(context, "spec", normalizedA, 2);
    expect(hits.length).toBe(2);
    expect(hits[0]?.id).toBe("docA");

    await store.remove(context, "spec", "docA");
    const after = await store.search(context, "spec", normalizedA, 2);
    expect(after.find((h) => h.id === "docA")).toBeUndefined();

    // تنظيف
    await store.remove(context, "spec", "docB");
    await prisma.$disconnect();
  });
});
