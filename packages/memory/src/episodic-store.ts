/**
 * الذاكرة العرضية L1 — منفذ EpisodicStore ومحوله داخل الذاكرة (وثيقة memory.md §L1).
 *
 * البنية الملزمة: مفاتيح `pipeline:{tenantId}:{runId}:events` و`:state`
 * بعمر افتراضي 7 أيام يُجدد مع كل كتابة. المحول داخل الذاكرة كامل
 * الوظائف للتطوير والاختبارات، والمحول الشبكي (Redis) في packages/infra
 * يطابق هذا المنفذ بنيوياً فلا يتغير أي مستهلك عند التبديل.
 *
 * قرار التصميم: عمليات المخازن تعيد Promise صريحة دون Result —
 * فشل التخزين عيب تشغيلي يُعالج عند المستهلك (run-service) لا في كل نداء.
 */

import {
  EPISODIC_TTL_SECONDS,
  Errors,
  PipelineEventSchema,
  RUN_SNAPSHOT_FIELD,
  RUN_STATUS_FIELD,
  pipelineEventsKey,
  pipelineStateKey,
  type PipelineEvent,
} from "@agentbridge/shared";

export interface EpisodicStore {
  /** يلحق حدثاً في stream التشغيل بعد تحققه مخططياً */
  appendEvent(tenantId: string, runId: string, event: PipelineEvent): Promise<void>;
  /** أحداث التشغيل بترتيب الوقوع — فارغة إن انتهت مدة الاحتفاظ */
  readEvents(tenantId: string, runId: string): Promise<readonly PipelineEvent[]>;
  /** يحفظ snapshot موقعة في حقل snapshot داخل hash الحالة */
  saveSnapshot(tenantId: string, runId: string, snapshotJson: string): Promise<void>;
  /** آخر snapshot أو null */
  loadSnapshot(tenantId: string, runId: string): Promise<string | null>;
  /** يحفظ حالة نصية قصيرة (finalStatus مثلاً) في حقل status */
  saveRunStatus(tenantId: string, runId: string, status: string): Promise<void>;
  loadRunStatus(tenantId: string, runId: string): Promise<string | null>;
}

interface ExpiringEntry<T> {
  readonly value: T;
  expiresAt: number;
}

export interface InMemoryEpisodicOptions {
  /** مدة الاحتفاظ بالثواني — تُحقن لاختبار الطرد الزمني */
  readonly ttlSeconds?: number;
  /** ساعة قابلة للحقن بالمللي ثانية */
  readonly now?: () => number;
}

/** محول داخل الذاكرة كامل الوظائف: نفس عقود المنفذ ونفس دلالات TTL */
export function createInMemoryEpisodicStore(options: InMemoryEpisodicOptions = {}): EpisodicStore {
  const ttlSeconds = options.ttlSeconds ?? EPISODIC_TTL_SECONDS;
  const now = options.now ?? (() => Date.now());
  const eventsByKey = new Map<string, ExpiringEntry<PipelineEvent[]>>();
  const stateByKey = new Map<string, ExpiringEntry<Record<string, string>>>();

  function liveEvents(key: string): PipelineEvent[] | null {
    const entry = eventsByKey.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= now()) {
      eventsByKey.delete(key);
      return null;
    }
    return entry.value;
  }

  function liveState(key: string): Record<string, string> | null {
    const entry = stateByKey.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt <= now()) {
      stateByKey.delete(key);
      return null;
    }
    return entry.value;
  }

  return {
    async appendEvent(tenantId, runId, event) {
      // بوابة الحدود: الحدث العابر يتحقق مخططياً قبل دخوله الذاكرة (القاعدة 16)
      const parsed = PipelineEventSchema.safeParse(event);
      if (!parsed.success) {
        throw Errors.invalidInput(`حدث لا يطابق مخطط PipelineEvent: ${parsed.error.issues[0]?.path.join(".") ?? "?"}`);
      }
      const key = pipelineEventsKey(tenantId, runId);
      const existing = liveEvents(key) ?? [];
      existing.push(parsed.data as PipelineEvent);
      eventsByKey.set(key, { value: existing, expiresAt: now() + ttlSeconds * 1000 });
    },

    async readEvents(tenantId, runId) {
      return [...(liveEvents(pipelineEventsKey(tenantId, runId)) ?? [])];
    },

    async saveSnapshot(tenantId, runId, snapshotJson) {
      if (typeof snapshotJson !== "string" || snapshotJson.length === 0) {
        throw Errors.invalidInput("snapshot يجب أن تكون نص JSON غير فارغ");
      }
      const key = pipelineStateKey(tenantId, runId);
      const fields = { ...(liveState(key) ?? {}), [RUN_SNAPSHOT_FIELD]: snapshotJson };
      stateByKey.set(key, { value: fields, expiresAt: now() + ttlSeconds * 1000 });
    },

    async loadSnapshot(tenantId, runId) {
      return liveState(pipelineStateKey(tenantId, runId))?.[RUN_SNAPSHOT_FIELD] ?? null;
    },

    async saveRunStatus(tenantId, runId, status) {
      const key = pipelineStateKey(tenantId, runId);
      const fields = { ...(liveState(key) ?? {}), [RUN_STATUS_FIELD]: status };
      stateByKey.set(key, { value: fields, expiresAt: now() + ttlSeconds * 1000 });
    },

    async loadRunStatus(tenantId, runId) {
      return liveState(pipelineStateKey(tenantId, runId))?.[RUN_STATUS_FIELD] ?? null;
    },
  };
}
