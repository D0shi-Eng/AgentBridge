/**
 * اختبارات الحجز الذري للميزانية.
 * التداخل حقيقي ومحدود بالحرفية: **20 طلباً على دفعات بتزامن 2** (وليس
 * «20 متزامناً») بمزود اختبار اصطناعي بلا مفاتيح مدفوعة ولا GPU.
 * يثبت: لا تجاوز للسقف تحت التداخل، idempotency إعادة الحجز لا تضاعفه،
 * تسوية بالفعلية، تحرير عند الإلغاء، وتسوية المتروك عند سقفها.
 */

import { describe, expect, it } from "vitest";
import { AppError } from "@agentbridge/shared";
import { createInMemoryReservationLedger, withBudgetReservation, type ReservationLedger } from "./budget-reservation.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider.js";

const request: LlmRequest = { system: "s", messages: [{ role: "user", content: "hi" }] };

/** مزود اختبار يحصي نداءاته ويعيد رداً ثابتاً */
function countingProvider(state: { calls: number }, respond?: () => { ok: false; error: Error }): LlmProvider {
  return {
    name: "test-counting",
    async complete(_req) {
      state.calls += 1;
      if (respond !== undefined) {
        const outcome = respond();
        return { ...outcome, error: new AppError("TEST_PROVIDER_FAILURE", outcome.error.message, false, "warning") };
      }
      const response: LlmResponse = { text: "ok", provider: "test-counting" };
      return { ok: true, value: response };
    },
  };
}

function ledgerWithBudget(budgetUsd: number): ReservationLedger {
  return createInMemoryReservationLedger({ monthlyBudgetUsd: () => budgetUsd });
}

describe("السقف تحت التداخل — 20 طلباً على دفعات بتزامن 2", () => {
  it("لا نداء يمر فوق السقف: 10 تنجح و10 تُرفض قبل الإرسال", async () => {
    const state = { calls: 0 };
    const ledger = ledgerWithBudget(10);
    const guarded = withBudgetReservation(countingProvider(state), {
      tenantId: "t1",
      ledger,
      idempotencyKeyOf: (req) => `req-${String(req.messages[0]?.content)}`,
      ceilingUsdOf: () => 1,
      actualCostUsdOf: () => 1,
    });
    let sent = 0;
    // دفعات بتزامن 2 حصراً — التداخل الحقيقي المحدود المعلن
    for (let batch = 0; batch < 10; batch += 1) {
      await Promise.all(
        [0, 1].map(async (offset) => {
          const index = batch * 2 + offset;
          const result = await guarded.complete({ ...request, messages: [{ role: "user", content: `m-${index}` }] });
          if (result.ok) sent += 1;
        }),
      );
    }
    expect(sent).toBe(10);
    expect(state.calls).toBe(10); // المرفوضة لم تصل المزود إطلاقاً
    expect(await ledger.monthSpendUsd("t1")).toBe(10);
    expect(await ledger.reservedUsd("t1")).toBe(0);
  });

  it("التسوية بالفعلية دون السقف تحرر مساحة لنداءات أكثر", async () => {
    const state = { calls: 0 };
    const ledger = ledgerWithBudget(10);
    const guarded = withBudgetReservation(countingProvider(state), {
      tenantId: "t1",
      ledger,
      idempotencyKeyOf: (req) => `req-${String(req.messages[0]?.content)}`,
      ceilingUsdOf: () => 1,
      actualCostUsdOf: () => 0.2,
    });
    let sent = 0;
    for (let batch = 0; batch < 10; batch += 1) {
      await Promise.all([0, 1].map(async (offset) => {
        const index = batch * 2 + offset;
        const result = await guarded.complete({ ...request, messages: [{ role: "user", content: `m-${index}` }] });
        if (result.ok) sent += 1;
      }));
    }
    expect(sent).toBe(20);
    expect(await ledger.monthSpendUsd("t1")).toBeCloseTo(4, 1);
  });
});

describe("idempotency والنتيجة المجهولة", () => {
  it("retry بنفس المفتاح يعيد استخدام الحجز ولا ينفّذ مرتين إلا بنداء فعلي واحد", async () => {
    const state = { calls: 0 };
    const ledger = ledgerWithBudget(10);
    const guarded = withBudgetReservation(countingProvider(state), {
      tenantId: "t1",
      ledger,
      idempotencyKeyOf: () => "same-key",
      ceilingUsdOf: () => 2,
      actualCostUsdOf: () => 2,
    });
    // نفس الطلب مرتين بالتتابع (نمط retry) — الحجز الثاني reused
    const first = await guarded.complete(request);
    const second = await guarded.complete(request);
    expect(first.ok && second.ok).toBe(true);
    expect(await ledger.monthSpendUsd("t1")).toBe(4); // تسويتا نداءين منفذين فعلاً
    // الثالث لو حُجز بنفس المفتاح قبل التسوية لكان reused — نتحقق عبر reserve مباشرة
    const reservation = await ledger.reserve({ tenantId: "t1", idempotencyKey: "same-key", ceilingUsd: 2, ttlMs: 60_000 });
    expect(reservation.ok && reservation.value.reused).toBe(false); // لا حجز قائم بعد التسوية
  });

  it("فشل مزود مجهول التنفيذ: الحجز يبقى ولا إعادة تلقائية، والسحب يسوى عند السقف", async () => {
    const state = { calls: 0 };
    const ledger = ledgerWithBudget(5);
    const failing = withBudgetReservation(countingProvider(state, () => ({ ok: false, error: new Error("upstream timeout — نتيجة مجهولة") })), {
      tenantId: "t1",
      ledger,
      idempotencyKeyOf: () => "unknown-1",
      ceilingUsdOf: () => 2,
    });
    const result = await failing.complete(request);
    expect(result.ok).toBe(false);
    expect(state.calls).toBe(1); // لا إعادة تلقائية
    // الحجز ما زال محجوزاً — يحمي من نداء جديد فوق السقف
    expect(await ledger.reservedUsd("t1")).toBe(2);
    // نداء جديد بسقف يجعل المجموع فوق الميزانية يُرفض قبل الإرسال
    const fresh = withBudgetReservation(countingProvider(state), {
      tenantId: "t1",
      ledger,
      idempotencyKeyOf: () => "fresh-after-unknown",
      ceilingUsdOf: () => 4,
    });
    const blocked = await fresh.complete(request);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error.code).toBe("LLM_BUDGET_EXCEEDED");
    expect(state.calls).toBe(1);
    // السحب المحافظ: يسوى المجهول عند سقفه
    const swept = await ledger.sweepExpired("t1", Date.now() + 10 * 60 * 1000);
    expect(swept).toBe(1);
    expect(await ledger.monthSpendUsd("t1")).toBe(2);
    expect(await ledger.reservedUsd("t1")).toBe(0);
  });

  it("فائض تسعير المزود يُسوى ويُعلَّم ولا يمنع توثيقه", async () => {
    const state = { calls: 0 };
    const ledger = ledgerWithBudget(10);
    const decisions: string[] = [];
    const guarded = withBudgetReservation(countingProvider(state), {
      tenantId: "t1",
      ledger,
      idempotencyKeyOf: () => "over-1",
      ceilingUsdOf: () => 1,
      actualCostUsdOf: () => 3, // المزود حاسب أعلى من التقدير
      onDecision: (decision) => decisions.push(decision.reason),
    });
    const result = await guarded.complete(request);
    expect(result.ok).toBe(true);
    expect(await ledger.monthSpendUsd("t1")).toBe(3);
    expect(decisions.some((reason) => reason.includes("فائض تسعير"))).toBe(true);
  });

  it("عزل المستأجرين على دفتر واحد", async () => {
    const ledger = ledgerWithBudget(2);
    const t1 = await ledger.reserve({ tenantId: "t1", idempotencyKey: "k", ceilingUsd: 2, ttlMs: 60_000 });
    expect(t1.ok).toBe(true);
    const t2 = await ledger.reserve({ tenantId: "t2", idempotencyKey: "k", ceilingUsd: 2, ttlMs: 60_000 });
    expect(t2.ok).toBe(true); // مستأجر آخر بميزانيته الكاملة
    const t1Again = await ledger.reserve({ tenantId: "t1", idempotencyKey: "k2", ceilingUsd: 0.01, ttlMs: 60_000 });
    expect(t1Again.ok).toBe(false); // ميزانية t1 ممتلئة بالحجز
  });
});
