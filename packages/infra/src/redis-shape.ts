/**
 * محول الذاكرة العرضية L1 فوق أوامر Redis — تطبيق وثيقة memory.md §L1 حرفياً:
 *   `pipeline:{tenantId}:{runId}:events` (stream) و`:state` (hash) بعمر 7 أيام.
 *
 * لا يستورد عميل Redis ولا يعرف الشبكة: يستقبل أصغر سطح أوامر يطلبه
 * (مطابق توقيعياً لعقد node-redis v4 الرسمي — ADR-13) فيُختبر هنا
 * بعميل مزيف موثّق الأوامر دون منافذ حقيقية. عند التشغيل الإنتاجي
 * يمرَّر العميل الحقيقي كما هو من apps/container.
 */

import {
  EPISODIC_TTL_SECONDS,
  Errors,
  PipelineEventSchema,
  pipelineEventsKey,
  pipelineStateKey,
  type PipelineEvent,
} from "@agentbridge/shared";
import type { EpisodicStore } from "@agentbridge/memory";
import { RUN_SNAPSHOT_FIELD, RUN_STATUS_FIELD } from "./episodic-fields.js";

/** أصغر سطح أوامر Redis الذي يحتاجه المحول (توقيعات node-redis v4) */
export interface RedisCommandsLike {
  xAdd(key: string, id: "*", fields: Record<string, string>): Promise<string>;
  xRange(key: string, start: string, stop: string): Promise<Array<{ id: string; message: Record<string, string> }>>;
  hSet(key: string, field: string, value: string): Promise<number>;
  hGetAll(key: string): Promise<Record<string, string>>;
  expire(key: string, seconds: number): Promise<boolean>;
}

export function createRedisShapedEpisodicStore(
  commands: RedisCommandsLike,
  ttlSeconds: number = EPISODIC_TTL_SECONDS,
): EpisodicStore {
  return {
    async appendEvent(tenantId, runId, event) {
      const parsed = PipelineEventSchema.safeParse(event);
      if (!parsed.success) {
        throw Errors.invalidInput("حدث لا يطابق مخطط PipelineEvent فرفضه محول L1");
      }
      await commands.xAdd(pipelineEventsKey(tenantId, runId), "*", { event: JSON.stringify(parsed.data) });
      await commands.expire(pipelineEventsKey(tenantId, runId), ttlSeconds);
    },

    async readEvents(tenantId, runId) {
      const rows = await commands.xRange(pipelineEventsKey(tenantId, runId), "-", "+");
      return rows.map((row) => {
        try {
          return JSON.parse(row.message["event"] ?? "") as PipelineEvent;
        } catch {
          throw Errors.internal(`حدث فاسد غير قابل للفك في stream ${row.id}`);
        }
      });
    },

    async saveSnapshot(tenantId, runId, snapshotJson) {
      const key = pipelineStateKey(tenantId, runId);
      await commands.hSet(key, RUN_SNAPSHOT_FIELD, snapshotJson);
      await commands.expire(key, ttlSeconds);
    },

    async loadSnapshot(tenantId, runId) {
      const fields = await commands.hGetAll(pipelineStateKey(tenantId, runId));
      return Object.keys(fields).length === 0 ? null : (fields[RUN_SNAPSHOT_FIELD] ?? null);
    },

    async saveRunStatus(tenantId, runId, status) {
      const key = pipelineStateKey(tenantId, runId);
      await commands.hSet(key, RUN_STATUS_FIELD, status);
      await commands.expire(key, ttlSeconds);
    },

    async loadRunStatus(tenantId, runId) {
      const fields = await commands.hGetAll(pipelineStateKey(tenantId, runId));
      return Object.keys(fields).length === 0 ? null : (fields[RUN_STATUS_FIELD] ?? null);
    },
  };
}
