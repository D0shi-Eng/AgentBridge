/**
 * عقود خدمة التشغيل — الأنواع التي يستهلكها container وroutes دون
 * فهم دواخل الحلقة. فصلها يبقي run-service.ts تحت حد الـ200 سطر.
 */

import type { EventEmitter } from "node:events";
import type { FastifyBaseLogger } from "fastify";
import type { CostLedger, LlmProvider } from "@agentbridge/llm";
import type { StageId } from "@agentbridge/shared";
import type { EpisodicStore, FlywheelStore, RunArchiveStore, SemanticStore } from "@agentbridge/memory";
import type { RunLeaseStore } from "@agentbridge/infra";
import type { HashChainAuditLog } from "@agentbridge/infra";

/** ضبط درع ميزانية النماذج — حضوره يفعّل الغلاف فوق مزود كل تشغيل */
export interface BudgetShield {
  readonly monthlyBudgetUsd: number;
  readonly ledger: CostLedger;
  /** مقدّر تكلفة حتمي — كل complete ناجح يسجل تكلفته فوراً */
  readonly estimateCostUsd?: (request: import("@agentbridge/llm").LlmRequest, response: import("@agentbridge/llm").LlmResponse) => number;
  /**
   * دفتر الحجوزات الذري بين العمليات (Redis في live).
   * حضوره مع ceilingUsdOf يفعّل مسار reserve→settle قبل/بعد كل نداء
   * بدل check-then-spend — نفس العقد المختبر في اختبارات الميزانية الحية.
   */
  readonly reservationLedger?: import("@agentbridge/llm").ReservationLedger;
  /**
   * سقف الحجز المقدّر لكل نداء (تقدير حتمي بالأحرف من إعداد الخادم).
   * سياسة التسعير التجارية النهائية قرار أعمال منفصل — المعاملات هنا تقنية
   * محافظة معلنة في .env.example لا قرار تجاري صامت.
   */
  readonly ceilingUsdOf?: (request: import("@agentbridge/llm").LlmRequest) => number;
}

export interface RunServiceDeps {
  readonly semantic: SemanticStore;
  readonly episodic: EpisodicStore;
  readonly audit: HashChainAuditLog;
  /** يبني مزوداً جديداً لكل تشغيل — لا مشاركة حالة بين تشغيلين */
  readonly providerFactory: () => LlmProvider;
  readonly workRoot: string;
  readonly logger?: FastifyBaseLogger;
  /** غيابه يعني بلا درع — وضع الاختبارات الافتراضي مع mock صفر التكلفة */
  readonly budget?: BudgetShield;
  /** دولاب التعلم L4 — حضوره يفعّل حفظ الدروس بعد كل تشغيل */
  readonly flywheel?: FlywheelStore;
  /**
   * تفعيل الفئات الحية من إعداد الخادم الموثوق — يشمل start
   * وresume معاً (الاستئناف لا يفقد البوابة). الافتراضي false مقصود.
   */
  readonly liveProbes?: boolean;
  /** تشغيل الفحوص الحية داخل حاوية معزولة بدل المضيف (إعداد خادم موثوق) */
  readonly sandboxProbes?: boolean;
  /**
   * القفل الموزع للاستئناف. غيابه = بلا قفل موزع (وضع
   * اختبارات عملية واحدة موثق)؛ حاضره يفرض إيجاراً حصرياً عبر العمليات.
   */
  readonly runLock?: RunLeaseStore;
  /** الأرشفة الدائمة L2 — مرجع الاستئناف بعد انتهاء TTL الـL1 */
  readonly runArchive?: RunArchiveStore;
  /** عمر إيجار التشغيل بالمللي — الافتراضي 60 ثانية مع تجديد دوري */
  readonly leaseTtlMs?: number;
  /**
   * مدة الاحتفاظ بمقود مكتمل قبل حذفه من الخريطة
   * (للمشتركين المتأخرين في البث). الافتراضي 60 ثانية؛ 0 = حذف فوري بعد
   * انقضاء مشتركيه. سياسة تقاعد معلنة لا نمو بلا حد.
   */
  readonly handleRetentionMs?: number;
  /**
   * مادة توقيع snapshots من إعداد الخادم + حلقة تحقق الدوران:
   * تمرر للمنسق فيبدأ التوقيع الثابت (لا مفتاح عابر لكل تشغيل) ويقبل
   * الاستئناف بمفاتيح سابقة للقراءة حتى انتهاء صلاحية ما وقّعت به.
   */
  readonly snapshotSigning?: import("@agentbridge/orchestrator").SnapshotSigningMaterial;
  readonly snapshotVerifyKeys?: import("@agentbridge/orchestrator").SnapshotKeyRing;
  /** مادة توقيع الشهادات داخل الأنبوب (CERT_SIGNING_PRIVATE_KEY) */
  readonly certificateSigning?: import("@agentbridge/evaluator").SigningKeyMaterial;
  /** صلاحية snapshots من سياسة الاحتفاظ المعلنة (ايام→ms) */
  readonly snapshotTtlMs?: number;
}

export interface RunHandle {
  readonly emitter: EventEmitter;
  readonly tenantId: string;
  promise: Promise<void> | null;
  done: boolean;
  /** إيجار القفل الموزع (توكن + fencing token) — null بلا قفل */
  lease?: { readonly ownerToken: string; readonly fence: number };
  /** فقد الإيجار (تجديد فاشل) → تُرفض كل كتابات لاحقة ويُوقف التشغيل */
  leaseLost?: boolean;
  /**
   * مؤقّت تجديد الإيجار — يُمسح فوراً عند انتهاء
   * التشغيل (لا ينتظر نبضة لاحقة) فلا يبقى مؤقّتاً يتيمياً بعد كل تشغيل.
   */
  renewalTimer?: ReturnType<typeof setInterval>;
  /**
   * مؤقّت تقاعد المقود بعد الاكتمال — يبقيه متاحاً
   * للمشتركين المتأخرين مدة سياسة معلنة ثم يحذفه من الخريطة (unref).
   */
  retireTimer?: ReturnType<typeof setTimeout>;
}

export interface StartOptions {
  readonly runId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly specId: string;
  readonly rawSpec: string;
  /** استئناف من snapshot معينة بدل بداية جديدة */
  readonly resumeSnapshot?: string;
  /** إيقاف متحكم به بعد مرحلة — لأغراض العرض واختبار الاستئناف */
  readonly suspendAfter?: StageId;
  /**
   * إيجار ولّده resume() قبل الإطلاق — يضمن قرار 409 صريحاً
   * عبر العمليات قبل بدء أي تنفيذ.
   */
  readonly preAcquiredLease?: { readonly ownerToken: string; readonly fence: number };
  /**
   * تشغيل الفئوص الحية لهذا التشغيل — الافتراضي false مقصود
   * (فشيل مغلق: بلا فئات حية لا شهادة منححة). تفعيله من إعداد الخادم
   * الموثوق فقط ولا يأتي من جسم الطلب إطلاقاً — العميل بلا ثقة هنا.
   */
  readonly liveProbes?: boolean;
}
