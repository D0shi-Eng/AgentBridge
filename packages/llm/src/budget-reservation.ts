/**
 * حجز ميزانية ذري — استبدال check-then-spend بعقد
 * reserve → call → settle/cancel قابل للتعدد بين العمليات.
 *
 * ماهيته: دفتر حجوزات فوق دفتر الإنفاق — كل نداء نموذج يحجز سقفه المقدّر
 * **قبل** إرساله، وتسوى تكلفته الفعلية بعده (أو يلغى حجزه إن فشل مؤكد).
 * وظيفته:
 *   - reserve ذرية: إما حجز جديد أو الحجز القائم بنفس مفتاح idempotency
 *     (retry لا يحجز مرتين) أو رفض LLM_BUDGET_EXCEEDED قبل أي إرسال.
 *   - settle بالفعلية: تسجيل التكلفة الفعلية وتحرير الحجز. الفعلي فوق
 *     السقف (فروق تسعير مزود غير مضمونة) يُسوى ويُعلَّم فائضاً — لا ندّعي
 *     منع كل تجاوز ناشئ عن التسعير، لكن نداءً جديداً لن يمر فوق السقف.
 *   - cancel: تحرير حجز نداء فشل مؤكد قبل التنفيذ.
 *   - sweep: الحجوزات المتروكة (نداء مجهول النتيجة/تعطل) تسوى عند سقفها —
 *     محافظ: لا تجاوز غير محسوب، ولا إعادة نداء تلقائية إطلاقاً.
 * كيف: التنفيذ الداخلي بلا await في القسم الحرج (ذرية بنيوية)؛ تنفيذ Redis
 * بـLua في packages/infra للعدد بين العمليات بنفس العقد.
 */

import { AppError, err, ok, type Result } from "@agentbridge/shared";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider.js";

/** حالة حجز واحدة */
export interface BudgetReservation {
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly ceilingUsd: number;
  /** لحظة انتهاء صلاحية الحجز (ms epoch) — بعدها يسوى بالسحب المحافظ */
  readonly expiresAtMs: number;
  /** true عند إعادة استخدام حجز قائم بنفس المفتاح (لا حجز مزدوج) */
  readonly reused: boolean;
}

/** دفتر الحجوزات — العقد الذري الوحيد للميزانية (يستبدل CostLedger المباشر في المسارات الجديدة) */
export interface ReservationLedger {
  reserve(input: { readonly tenantId: string; readonly idempotencyKey: string; readonly ceilingUsd: number; readonly ttlMs: number; readonly nowMs?: number }): Promise<Result<BudgetReservation>>;
  /** تسوية بالتكلفة الفعلية — فوق السقف يمر مسجلاً بعلامة فائض (لا رفض صامت) */
  settle(input: { readonly tenantId: string; readonly idempotencyKey: string; readonly actualUsd: number }): Promise<Result<{ readonly overCeiling: boolean }>>;
  cancel(input: { readonly tenantId: string; readonly idempotencyKey: string }): Promise<Result<void>>;
  /** مجموع الإنفاق المسجل للشهر */
  monthSpendUsd(tenantId: string): Promise<number>;
  /** مجموع الحجوزات النشطة */
  reservedUsd(tenantId: string): Promise<number>;
  /** يسوي الحجوزات المنتهية عند سقوفها ويعيد عددها */
  sweepExpired(tenantId: string, nowMs?: number): Promise<number>;
}

/** رفض الميزانية الموحد — نفس رمز الدرع القائم فلا كسر لمستهلكين */
export function budgetExceeded(detail: string): AppError {
  return new AppError("LLM_BUDGET_EXCEEDED", detail, false, "warning");
}

/** دفتر حجوزات داخل الذاكرة — الذرية بنيوية: لا await بين الفحص والكتابة */
export function createInMemoryReservationLedger(options: {
  readonly monthlyBudgetUsd: (tenantId: string) => number;
  readonly now?: () => number;
}): ReservationLedger {
  const now = options.now ?? Date.now;
  const spend = new Map<string, number>();
  const active = new Map<string, { ceilingUsd: number; expiresAtMs: number }>();
  const keyOf = (tenantId: string, idempotencyKey: string): string => `${tenantId}::${idempotencyKey}`;
  const totalCommitted = (tenantId: string): number => {
    let reserved = 0;
    for (const [key, reservation] of active) {
      if (!key.startsWith(`${tenantId}::`)) continue;
      if (reservation.expiresAtMs <= now()) continue; // منتهٍ — لا يُحسب (يسوى بالسحب)
      reserved += reservation.ceilingUsd;
    }
    return (spend.get(tenantId) ?? 0) + reserved;
  };
  return {
    async reserve({ tenantId, idempotencyKey, ceilingUsd, ttlMs, nowMs }) {
      const atMs = nowMs ?? now();
      const key = keyOf(tenantId, idempotencyKey);
      const existing = active.get(key);
      if (existing !== undefined && existing.expiresAtMs > atMs) {
        return ok({ tenantId, idempotencyKey, ceilingUsd: existing.ceilingUsd, expiresAtMs: existing.expiresAtMs, reused: true });
      }
      if (ceilingUsd < 0) return err(budgetExceeded("سقف حجز سالب — رُفض"));
      if (totalCommitted(tenantId) + ceilingUsd > options.monthlyBudgetUsd(tenantId)) {
        return err(budgetExceeded(`رُفض الحجز قبل الإرسال: الملتزم ${(totalCommitted(tenantId)).toFixed(2)}$ + السقف المطلوب ${ceilingUsd.toFixed(2)}$ يتجاوز ميزانية ${options.monthlyBudgetUsd(tenantId).toFixed(2)}$`));
      }
      active.set(key, { ceilingUsd, expiresAtMs: atMs + ttlMs });
      return ok({ tenantId, idempotencyKey, ceilingUsd, expiresAtMs: atMs + ttlMs, reused: false });
    },
    async settle({ tenantId, idempotencyKey, actualUsd }) {
      const key = keyOf(tenantId, idempotencyKey);
      const reservation = active.get(key);
      if (reservation === undefined) return err(budgetExceeded("تسوية بلا حجز نشط — رُفضت (لا إنفاق خارج الحجز)"));
      active.delete(key);
      const previous = spend.get(tenantId) ?? 0;
      spend.set(tenantId, previous + actualUsd);
      return ok({ overCeiling: actualUsd > reservation.ceilingUsd });
    },
    async cancel({ tenantId, idempotencyKey }) {
      active.delete(keyOf(tenantId, idempotencyKey));
      return ok(undefined);
    },
    async monthSpendUsd(tenantId) {
      return spend.get(tenantId) ?? 0;
    },
    async reservedUsd(tenantId) {
      let reserved = 0;
      for (const [key, reservation] of active) {
        if (key.startsWith(`${tenantId}::`) && reservation.expiresAtMs > now()) reserved += reservation.ceilingUsd;
      }
      return reserved;
    },
    async sweepExpired(tenantId, nowMs) {
      const atMs = nowMs ?? now();
      let swept = 0;
      for (const [key, reservation] of [...active]) {
        if (!key.startsWith(`${tenantId}::`) || reservation.expiresAtMs > atMs) continue;
        active.delete(key);
        spend.set(tenantId, (spend.get(tenantId) ?? 0) + reservation.ceilingUsd);
        swept += 1;
      }
      return swept;
    },
  };
}

/** خيارات غلاف الحجز فوق مزود */
export interface BudgetReservationGuardOptions {
  readonly tenantId: string;
  readonly ledger: ReservationLedger;
  /** مفتاح idempotency حتمي لكل نداء — إلزامي بلا افتراضي (لا حماية بلا مفتاح) */
  readonly idempotencyKeyOf: (request: LlmRequest) => string;
  /** سقف التكلفة المقدّر للنداء — يُحجز قبل الإرسال */
  readonly ceilingUsdOf: (request: LlmRequest) => number;
  /** التكلفة الفعلية بعد الرد — غيابها يسوي عند السقف (محافظ موثق) */
  readonly actualCostUsdOf?: (request: LlmRequest, response: LlmResponse) => number;
  /** عمر حجز النداء — بعده يسوى بالسحب (افتراضي 5 دقائق) */
  readonly reservationTtlMs?: number;
  readonly onDecision?: (decision: { readonly allowed: boolean; readonly tenantId: string; readonly reason: string }) => void;
}

/** يلفط مزوداً بعقد الحجز الذري — النداء يمر فقط تحت حجز نشط */
export function withBudgetReservation(provider: LlmProvider, options: BudgetReservationGuardOptions): LlmProvider {
  const ttlMs = options.reservationTtlMs ?? 5 * 60 * 1000;
  return {
    name: `${provider.name}+reservation`,
    async complete(request: LlmRequest) {
      const idempotencyKey = options.idempotencyKeyOf(request);
      const ceilingUsd = options.ceilingUsdOf(request);
      const reserved = await options.ledger.reserve({ tenantId: options.tenantId, idempotencyKey, ceilingUsd, ttlMs });
      if (!reserved.ok) {
        options.onDecision?.({ allowed: false, tenantId: options.tenantId, reason: reserved.error.message });
        return { ok: false, error: reserved.error };
      }
      options.onDecision?.({ allowed: true, tenantId: options.tenantId, reason: `حجز ${ceilingUsd.toFixed(2)}$ (reused=${reserved.value.reused}) قبل النداء` });

      const response = await provider.complete(request);
      if (response.ok) {
        // تسوية بالفعلية؛ بلا مقدّر فعلي نسوى عند السقف (محافظ — موثق)
        const actualUsd = options.actualCostUsdOf !== undefined ? options.actualCostUsdOf(request, response.value) : ceilingUsd;
        const settled = await options.ledger.settle({ tenantId: options.tenantId, idempotencyKey, actualUsd });
        if (settled.ok && settled.value.overCeiling) {
          options.onDecision?.({ allowed: true, tenantId: options.tenantId, reason: `فائض تسعير مزود: الفعلية ${actualUsd.toFixed(2)}$ فوق السقف ${ceilingUsd.toFixed(2)}$ — سُجلت ونداء جديد لن يمر` });
        }
        return response;
      }
      // فشل مزود: لا نهلم إن كان النداء نُفذ أم لا — الحجز يبقى محجوزاً بسقفه
      // (لا إعادة تلقائية، ولا تحرير يفتح ثغرة إنفاق)؛ retry بنفس مفتاح
      // idempotency يعيد استخدام الحجز نفسه، والسحب يسوى المجهول عند سقفه.
      options.onDecision?.({ allowed: true, tenantId: options.tenantId, reason: "فشل مزود بنتيجة مجهولة التنفيذ — الحجز محفوظ ولا إعادة تلقائية" });
      return response;
    },
  };
}
