/**
 * أرشيف حالة التشغيل الدائم — طبقة L2 التي تبقى مرجع
 * الاستئناف بعد انتهاء TTL الـL1 (Redis).
 *
 * ماهيته: عقد خزن snapshot موقعة بكل تشغيل مع جيله وfencing token.
 * وظيفته:
 *   - archive: كتابة مشروطة تصاعدية — يرفض snapshot بجيل ≤ المخزن أو fence
 *     < المخزن (CAS بنيوي). هذا هو موضع فرض fencing: مالك قديم عاد بعد
 *     انتهاء إيجاره لا يستطيع الكتابة فوق حالة مالك أحدث.
 *   - latest: آخر حالة معتمدة (أعلى generation/fence) للاستئناف.
 * كيف: تنفيذ داخل الذاكرة للاختبارات والتطوير؛ تنفيذ Prisma في infra
 * (prisma-run-archive) يطبق نفس الشرط في SQL. لا يقرأ ولا يكتب بلا
 * (tenantId, runId) معاً — عزل مستأجر بنطاق المفتاح.
 */

import { AppError, err, ok, type Result } from "@agentbridge/shared";

export interface RunArchiveRecord {
  readonly snapshotJson: string;
  readonly generation: number;
  readonly fence: number;
  readonly archivedAt: string;
}

export interface RunArchiveStore {
  /**
   * أرشفة شرطية: تقبل فقط (generation أعلى) أو (نفس الجيل مع fence أعلى) —
   * رفض الرمز REJECT: كتابة مالك قديم أو إعادة قديمة.
   */
  archive(input: { readonly tenantId: string; readonly runId: string; readonly snapshotJson: string; readonly generation: number; readonly fence: number; readonly archivedAt?: string }): Promise<Result<void>>;
  /** FC — مسح أرشيف المستأجر الأقدم من cutoff حصراً؛ يعيد عدد المحذوف */
  purgeExpiredBefore(tenantId: string, cutoffIso: string): Promise<number>;
  /** آخر أرشيف للمستأجر والتشغيل — null إن لم يوجد */
  latest(tenantId: string, runId: string): Promise<RunArchiveRecord | null>;
}

/** رفض الأرشفة برمز ثابت — التفريق بين كتابة قديمة (stale) وفشل خزن */
export function staleArchiveError(detail: string): AppError {
  return new AppError("STALE_ARCHIVE_WRITE", detail, false, "warning");
}

/** تنفيذ داخل الذاكرة — شرط التصاعد مطبق في نقطة واحدة غير قابلة للقطع */
export function createInMemoryRunArchiveStore(options: { readonly now?: () => string } = {}): RunArchiveStore {
  const now = options.now ?? (() => new Date().toISOString());
  const byKey = new Map<string, RunArchiveRecord>();
  return {
    async archive({ tenantId, runId, snapshotJson, generation, fence, archivedAt }) {
      const key = `${tenantId}:${runId}`;
      const existing = byKey.get(key);
      if (existing !== undefined) {
        const newerGeneration = generation > existing.generation;
        const sameGenerationHigherFence = generation === existing.generation && fence > existing.fence;
        if (!newerGeneration && !sameGenerationHigherFence) {
          return err(staleArchiveError(`أرشفة مرفوضة (generation ${generation}/fence ${fence}) لا تفوق المخزن (${existing.generation}/${existing.fence}) — كتابة مالك قديم`));
        }
      }
      byKey.set(key, { snapshotJson, generation, fence, archivedAt: archivedAt ?? now() });
      return ok(undefined);
    },
    async latest(tenantId, runId) {
      return byKey.get(`${tenantId}:${runId}`) ?? null;
    },
    async purgeExpiredBefore(tenantId, cutoffIso) {
      const cutoff = Date.parse(cutoffIso);
      const prefix = `${tenantId}:`;
      let removed = 0;
      for (const [key, record] of [...byKey]) {
        if (key.startsWith(prefix) && Date.parse(record.archivedAt) < cutoff) {
          byKey.delete(key);
          removed += 1;
        }
      }
      return removed;
    },
  };
}

/**
 * غلاف مسور فوق أي SnapshotStore — يضيف فحص fence/generation فوق كل كتابة:
 * يفوض الأرشفة للمخزن الدائم ويرفض الكتابة إذا رفض الأرشفة (فشل مغلقاً).
 * هذا يجعل «الكتابة الدائمة» نفسها بوابة fencing لا مجرد سجل.
 */
export function createFencedSnapshotSave(input: {
  readonly archive: RunArchiveStore;
  readonly tenantId: string;
  readonly runId: string;
  /** fence الحالي للمالك — يتجدد مع كل acquire ويقرأ من الحاوية */
  readonly fenceOf: () => number;
  /** هل ما زال مالك الإيجار حياً؟ فقد الإيجار = رفض كل كتابة لاحقة */
  readonly leaseAlive: () => boolean;
}): (snapshotJson: string, generation: number) => Promise<void> {
  return async (snapshotJson, generation) => {
    if (!input.leaseAlive()) {
      throw staleArchiveError("فقد الإيجار — الكتابة مرفوضة بعد انتهاء/خسارة القفل");
    }
    const fenced = await input.archive.archive({
      tenantId: input.tenantId,
      runId: input.runId,
      snapshotJson,
      generation,
      fence: input.fenceOf(),
    });
    if (!fenced.ok) throw fenced.error;
  };
}
