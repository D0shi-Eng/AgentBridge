/**
 * دوال حل مخازن الذاكرة — تفصل منطق اختيار InMemory مقابل Live
 * عن تجميع الحاوية الرئيسي لتبقي container.ts ≤200 سطر.
 */

import type { AppConfig } from "@agentbridge/infra";
import type { EpisodicStore, SemanticStore, VectorStore } from "@agentbridge/memory";
import { createInMemoryEpisodicStore, createInMemorySemanticStore, createInMemoryVectorStore } from "@agentbridge/memory";
import { createPrismaSemanticStore, createRedisShapedEpisodicStore, createPgVectorStore, assertRestrictedRole } from "@agentbridge/infra";
import { PrismaClient } from "@prisma/client";
import { connectOnDemand, type RedisSetNxView } from "./redis-connector.js";
import { createClient as createRedisClient } from "redis";

/** واجهات Redis الحية لخدمات التزامن — القفل والميزانية والاستهلاك الأحادي */
export interface LiveRedisViews {
  readonly lockCommands: ReturnType<typeof connectOnDemand>["lockCommands"];
  readonly budgetCommands: ReturnType<typeof connectOnDemand>["budgetCommands"];
  readonly setNx: RedisSetNxView;
}

export interface ResolvedStores {
  readonly semantic: SemanticStore;
  readonly episodic: EpisodicStore;
  readonly vectorStore: VectorStore;
  readonly prisma: PrismaClient | undefined;
  readonly closers: Array<() => Promise<void>>;
  /** حاضر في live فقط: نفس اتصال المخازن العرضية بلا عملاء موازين */
  readonly redisViews?: LiveRedisViews;
}

/** يحل المخازن الثلاثة (Semantic, Episodic, Vector) حسب نمط الاستدامة */
export async function resolveStores(
  config: AppConfig,
  overrides: {
    readonly semantic?: SemanticStore;
    readonly episodic?: EpisodicStore;
    readonly vectorStore?: VectorStore;
  },
): Promise<ResolvedStores> {
  let closers: Array<() => Promise<void>> = [];
  let prisma: PrismaClient | undefined;
  let redisViews: LiveRedisViews | undefined;

  let semantic = overrides.semantic;
  let episodic = overrides.episodic;
  let vectorStore = overrides.vectorStore;

  if ((semantic === undefined || episodic === undefined || vectorStore === undefined) && config.persistence === "live") {
    const prismaClient = new PrismaClient({ datasources: { db: { url: config.databaseUrl } } });
    // فحص الدور المقيد fail-closed عند الإقلاع في نمط live —
    // حساب superuser أو BYPASSRLS أو مالك الجداول يتجاوز RLS فيُرفض الإقلاع
    // بصراحة بدل التشغيل بامتيازات تكسر ضمان العزل.
    await assertRestrictedRole(prismaClient);
    prisma = prismaClient;
    const redis = connectOnDemand(createRedisClient({ url: config.redisUrl }));
    closers = [async () => { await prismaClient.$disconnect(); }, redis.disconnect];
    if (semantic === undefined) semantic = createPrismaSemanticStore(prismaClient);
    // TTL الأحداث من سياسة الاحتفاظ المعلنة لا ثابت صامت
    if (episodic === undefined) episodic = createRedisShapedEpisodicStore(redis.commands, config.retentionPolicy.episodicEventsDays * 24 * 60 * 60);
    if (vectorStore === undefined) vectorStore = createPgVectorStore(prismaClient);
    // واجهات القفل/الميزانية/الاستهلاك فوق نفس الاتصال — التزامن
    // بين النسخ ببنية اتصال واحدة (لا عملاء موازية بلا حاجة)
    redisViews = { lockCommands: redis.lockCommands, budgetCommands: redis.budgetCommands, setNx: redis.setNx };
  }

  const resolvedSemantic: SemanticStore = semantic ?? createInMemorySemanticStore();
  // نفس سياسة الاحتفاظ تسري على محول الذاكرة في التطوير
  const resolvedEpisodic: EpisodicStore = episodic
    ?? createInMemoryEpisodicStore({ ttlSeconds: config.retentionPolicy.episodicEventsDays * 24 * 60 * 60 });
  const resolvedVectorStore: VectorStore = vectorStore ?? createInMemoryVectorStore();

  return {
    semantic: resolvedSemantic,
    episodic: resolvedEpisodic,
    vectorStore: resolvedVectorStore,
    prisma,
    closers,
    ...(redisViews !== undefined ? { redisViews } : {}),
  };
}