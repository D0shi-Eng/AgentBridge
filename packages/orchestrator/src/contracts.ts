/**
 * عقود المحرك العامة — الأنواع التي يتعامل معها العالم الخارجي.
 *
 * فصلها عن منطق المحرك يجعل استهلاكها (CLI/الواجهات/طبقة الذاكرة)
 * لا يستوجب فهم حلقات التنفيذ الداخلية، ويحفظ حد الـ200 سطر للملفات.
 */

import type { Certificate, PipelineEvent, StageId, TenantContext } from "@agentbridge/shared";
import type { HardenOptions } from "./nodes/harden-node.js";
import type { SleepFn } from "./retry-policy.js";
import type { SnapshotKeyRing, SnapshotResumeBinding, SnapshotSigningMaterial } from "./snapshot-signing.js";

// واجهة Flywheel المحلية — مطابقة بنيوياً لـ memory/FlywheelStore بلا اعتماد جرياني
export interface FlywheelStore {
  saveLesson(context: TenantContext, lesson: { specPattern: string; designDecision: string; outcome: "success" | "failure"; score: number; tenantId: string; createdAt: string; id?: string }): Promise<void>;
  topK(context: TenantContext, query: string, k: number): Promise<{ specPattern: string; designDecision: string; outcome: "success" | "failure"; score: number; tenantId: string; createdAt: string; id?: string }[]>;
  listRecent(context: TenantContext, limit: number): Promise<{ specPattern: string; designDecision: string; outcome: "success" | "failure"; score: number; tenantId: string; createdAt: string; id?: string }[]>;
  deleteLesson(context: TenantContext, id: string): Promise<void>;
  analytics(context: TenantContext, range: "7d" | "30d" | "90d"): Promise<{ totalLessons: number; avgScore: number; successRate: number; successCount: number; histogram: readonly number[]; topPatterns: readonly { pattern: string; count: number; avgScore: number }[]; trend: readonly { date: string; count: number }[] }>;
}

/** مخزن snapshots — الواجهة التي تنفذها طبقة الذاكرة */
export interface SnapshotStore {
  save(runId: string, snapshot: string): Promise<void>;
  load(runId: string): Promise<string | null>;
}

/** مخزن داخل الذاكرة — الافتراضي للتطوير والاختبارات */
export function createMemorySnapshotStore(): SnapshotStore {
  const map = new Map<string, string>();
  return {
    async save(runId, snapshot) {
      map.set(runId, snapshot);
    },
    async load(runId) {
      return map.get(runId) ?? null;
    },
  };
}

export interface OrchestratorOptions {
  readonly runId: string;
  readonly tenantId: string;
  readonly rawSpec: string;
  /** مزود النماذج الذي تعتمه العقد الوكلية — mock في هذه المرحلة */
  readonly provider: import("@agentbridge/llm").LlmProvider;
  readonly harden: HardenOptions;
  /** مهلة الانتظار القابلة للحقن — الاختبارات تمرر no-op */
  readonly sleep?: SleepFn;
  /** مشترك الأحداث الحية (CLI/اللوحة) */
  readonly onEvent?: (event: PipelineEvent) => void;
  /** مخزن snapshots — الافتراضي داخل الذاكرة */
  readonly store?: SnapshotStore;
  /** دولاب التعلم L4 — يحقن الدروس في المصمم والمصلح (S12) */
  readonly flywheel?: FlywheelStore;
  /**
   * مادة توقيع snapshots — الغياب يولّد مفتاحاً عابراً للتشغيل الواحد
   * (يصح للاختبار؛ الإنتاج يمرر مفتاح إعداد الخادم الموثوق عبر keyRing).
   */
  readonly snapshotSigning?: SnapshotSigningMaterial;
  /**
   * حلقة تحقق الدوران: مفاتيح عامة سابقة تُقبل للتحقق فقط (قراءة)
   * حتى تنتهي صلاحية snapshots الموقعة بها؛ الإصدار يبقى بالمفتاح الحالي.
   */
  readonly snapshotVerifyKeys?: SnapshotKeyRing;
  /**
   * مادة توقيع الشهادات من إعداد الخادم (CERT_SIGNING_PRIVATE_KEY):
   * حضورها يوقّع الشهادة داخل الأنبوب؛ غيابها يتركها غير موقعة مع بقاء
   * بوابات المنح — لا توقيع وهمي ولا رفض صامت.
   */
  readonly certificateSigning?: import("@agentbridge/evaluator").SigningKeyMaterial;
  /** ربط هوية الاستئناف الذي يُوقّع داخل snapshot */
  readonly resumeBinding?: SnapshotResumeBinding;
  /** من يستأنف فعلاً + إصدار تخويله الحالي — يتحقق عند resume حصراً */
  readonly resumer?: { readonly subjectId?: string; readonly authorizationVersion?: number };
  /** حدود زمن/موردية لحلقة الإصلاح — الغياب يعتمد الافتراضيات الموثقة
   * في وثيقة 06 (deadline 120s وسقف رموز محكم) لا غياب حدود. */
  readonly repairLimits?: RepairRuntimeLimits;
  /** بصمات المدخلات التي توقّع داخل snapshot (rawSpec وغيره) */
  readonly inputDigests?: Readonly<Record<string, string>>;
  /**
   * صلاحية snapshots الموقعة من سياسة الاحتفاظ المعلنة.
   * الغياب يعتمد الافتراضي الموثق (7 أيام) — لا تمديد صامت في أي حال.
   */
  readonly snapshotTtlMs?: number;
}

/** حدود زمنية/موردية لحلقة الإصلاح — فرضها المحرك لا الوكيل */
export interface RepairRuntimeLimits {
  /** مهلة كل دورة إصلاح بالمللي — تجاوزها يصعد needs_human */
  readonly cycleDeadlineMs: number;
  /** سقف تراكمي لأحرف مخرجات النموذج في الدورة (تقدير رموز حتمي) */
  readonly maxCompletionChars: number;
}

/** خلاصة تشغيل كاملة أو متوقفة */
export interface RunSummary {
  readonly runId: string;
  readonly finalStatus: "completed" | "failed" | "needs_human" | "suspended";
  /** المرحلة التي توقف عندها التشغيل إن وُجدت */
  readonly stoppedAt?: StageId;
  /** سبب التوقف بالعربية */
  readonly reason?: string;
  /** عدد دورات الإصلاح المستهلكة خلال التشغيل كله */
  readonly repairCyclesUsed: number;
  readonly certificate?: Certificate;
  readonly events: readonly PipelineEvent[];
  /** آخر snapshot دائماً — مدخل الاستئناف الوحيد */
  readonly snapshot: string;
}
