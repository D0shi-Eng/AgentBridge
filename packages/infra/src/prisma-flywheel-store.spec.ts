/**
 * اختبارات دولاب التعلم الحي — PrismaFlywheelStore فوق PostgreSQL حي.
 *
 * المحول الحي + المبدئون النقيون. عند غياب القاعدة يتخطى موثقاً (لا كسر CI).
 */

import { randomUUID } from "node:crypto";
import { LIVE_DATABASE_URL } from "./live-config.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { VectorStore } from "@agentbridge/memory";
import { createPrismaFlywheelStore } from "./prisma-flywheel-store.js";
import { lessonFromRow, lessonToRow } from "./flywheel-mappers.js";
import type { TenantContext } from "@agentbridge/shared";

/** بديل L3 للاختبار: هذه المواصفة تقيس L2 حصراً — التضمين 1536 حتمي يقبل كما هو */
const vectorStub: VectorStore = {
  upsert: async () => undefined,
  remove: async () => undefined,
  search: async () => [],
};

function tenantContext(tenantId: string): TenantContext {
  return {
    tenantId,
    principal: {
      actorType: "service", authMethod: "api_key", subjectId: "integration-test",
      tenantId, credentialId: "integration-test", authorizationVersion: 1,
      permissions: ["flywheel:read", "flywheel:write"],
    },
  };
}

const DATABASE_URL =
  process.env.AB_LIVE_DATABASE_URL ?? LIVE_DATABASE_URL;

async function probeDatabase(): Promise<boolean> {
  const separator = DATABASE_URL.includes("?") ? "&" : "?";
  const probe = new PrismaClient({ datasources: { db: { url: `${DATABASE_URL}${separator}connect_timeout=2` } } });
  try {
    await probe.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.$disconnect();
  }
}

const available = await probeDatabase();
if (!available) {
  console.info(
    "[تخطٍّ موثق] اختبار PrismaFlywheelStore التكاملي: لا قاعدة PostgreSQL حية — أقلع docker-compose.dev.yaml أو اضبط AB_LIVE_DATABASE_URL",
  );
}

describe("flywheel-mappers نقية", () => {
  it("lessonToRow/FromRow ذهاب وإياب بلا فقد", () => {
    const lesson = { specPattern: "hash-xyz", designDecision: "قرار", outcome: "success" as const, score: 88, tenantId: "t1", createdAt: "2026-01-01T00:00:00.000Z" };
    const row = lessonToRow(lesson);
    expect(row.tenant_id).toBe("t1");
    expect(row.spec_pattern).toBe("hash-xyz");
    const restored = lessonFromRow(row);
    expect(restored.specPattern).toBe(lesson.specPattern);
    expect(restored.tenantId).toBe(lesson.tenantId);
    expect(restored.score).toBe(lesson.score);
    expect(restored.id).toBe(row.id);
  });
});

const PREFIX = `it-flywheel-${randomUUID().slice(0, 8)}-`;

describe.skipIf(!available)("PrismaFlywheelStore فوق PostgreSQL حي", () => {
  let prisma: PrismaClient;
  let store: ReturnType<typeof createPrismaFlywheelStore>;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });
    const vector = vectorStub;
    store = createPrismaFlywheelStore(prisma, vector);
  });

  afterAll(async () => {
    await prisma.flywheelLesson.deleteMany({ where: { tenant_id: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("يحفظ درساً ويسترجعه عبر topK حتمي", async () => {
    const lesson = { specPattern: `${PREFIX}pattern-a`, designDecision: "دمج أداتين", outcome: "success" as const, score: 92, tenantId: `${PREFIX}t1`, createdAt: new Date().toISOString() };
    const context = tenantContext(lesson.tenantId);
    await store.saveLesson(context, lesson);
    const hits = await store.topK(context, `${PREFIX}pattern-a`, 3);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0]?.specPattern).toBe(lesson.specPattern);
  });

  it("topK يعيد الأعلى درجة عند تعدد الدروس لنفس النمط", async () => {
    const pattern = `${PREFIX}pattern-b`;
    const tenant = `${PREFIX}t2`;
    const context = tenantContext(tenant);
    const now = new Date().toISOString();
    await store.saveLesson(context, { specPattern: pattern, designDecision: "a", outcome: "success", score: 60, tenantId: tenant, createdAt: now });
    await store.saveLesson(context, { specPattern: pattern, designDecision: "b", outcome: "success", score: 95, tenantId: tenant, createdAt: new Date(Date.now() + 1).toISOString() });
    const hits = await store.topK(context, pattern, 1);
    expect(hits[0]?.score).toBe(95);
  });
});
