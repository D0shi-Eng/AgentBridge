/**
 * اختبارات درع الميزانية — الرفض قبل الإرسال، تراكم الإنفاق، وقرارات
 * onDecision في الاتجاهين. مزيف موثق الأوامر بلا شبكة.
 */
import { describe, expect, it } from "vitest";
import { ok, type Result } from "@agentbridge/shared";
import { createInMemoryCostLedger, withBudgetGuard } from "./budget-guard.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider.js";

const REQUEST: LlmRequest = { system: "نظام", messages: [{ role: "user", content: "صمم" }] };
const RESPONSE: Result<LlmResponse> = ok({ text: '{"any":"json"}', provider: "fake" });

/** مزود جاسوس يعد نداءاته ويرفض ما بعد سقف عددها إن حُدد */
function spyProvider(limit = Number.POSITIVE_INFINITY): { provider: LlmProvider; calls: number[] } {
  let count = 0;
  const calls: number[] = [];
  const provider: LlmProvider = {
    name: "fake",
    async complete(_request) {
      count += 1;
      calls.push(count);
      if (count > limit) throw new Error("لا يفترض أن يُنادى أصلاً");
      return RESPONSE;
    },
  };
  return { provider, calls };
}

describe("withBudgetGuard", () => {
  it("يمنح النداء تحت السقف ويسجل قرار السماح", async () => {
    const ledger = createInMemoryCostLedger();
    const decisions: string[] = [];
    const { provider, calls } = spyProvider();
    const guarded = withBudgetGuard(provider, {
      tenantId: "t1",
      monthlyBudgetUsd: 10,
      ledger,
      onDecision: (decision) => decisions.push(decision.allowed ? "allow" : "reject"),
    });

    const result = await guarded.complete(REQUEST);

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(decisions).toEqual(["allow"]);
  });

  it("يرفض قبل إرسال أي نداء عند بلوغ السقف — المزود لا يُلم", async () => {
    const ledger = createInMemoryCostLedger();
    await ledger.addSpend("t1", 10);
    const decisions: Array<{ allowed: boolean; reason: string }> = [];
    const { provider, calls } = spyProvider();
    const guarded = withBudgetGuard(provider, {
      tenantId: "t1",
      monthlyBudgetUsd: 10,
      ledger,
      onDecision: (decision) => decisions.push({ allowed: decision.allowed, reason: decision.reason }),
    });

    const result = await guarded.complete(REQUEST);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_BUDGET_EXCEEDED");
      expect(result.error.message).toContain("قبل إرساله");
      expect(result.error.retryable).toBe(false);
    }
    expect(calls).toHaveLength(0);
    expect(decisions[0]?.allowed).toBe(false);
  });

  it("التراكم عبر النداءات يبلغ السقف فيرفض التالي — والعزل بين المستأجرين", async () => {
    const ledger = createInMemoryCostLedger();
    const { provider, calls } = spyProvider();
    let unitCost = 8;
    const guarded = withBudgetGuard(provider, {
      tenantId: "t1",
      monthlyBudgetUsd: 8,
      ledger,
      estimateCostUsd: () => unitCost,
    });
    const otherSpy = spyProvider();
    const other = withBudgetGuard(otherSpy.provider, {
      tenantId: "t2",
      monthlyBudgetUsd: 8,
      ledger,
      estimateCostUsd: () => 3,
    });

    // النداء الأول يستهلك السقف كاملاً (8$)
    expect((await guarded.complete(REQUEST)).ok).toBe(true);
    // الثاني يُرفض قبل الإرسال لأن الإنفاق 8 ≥ السقف 8
    unitCost = 1;
    const rejected = await guarded.complete(REQUEST);
    // مستأجر آخر بدفتر مشترك له سقفه المستقل
    expect((await other.complete(REQUEST)).ok).toBe(true);

    expect(rejected.ok).toBe(false);
    expect(calls).toHaveLength(1);
    expect(await ledger.monthSpendUsd("t1")).toBe(8);
    expect(await ledger.monthSpendUsd("t2")).toBe(3);
  });

  it("بلا مقدر تكلفة لا يتغير الدفتر — الصفر تكلفة افتراضي صريح", async () => {
    const ledger = createInMemoryCostLedger();
    const guarded = withBudgetGuard(spyProvider().provider, {
      tenantId: "t1",
      monthlyBudgetUsd: 1,
      ledger,
    });
    await guarded.complete(REQUEST);
    expect(await ledger.monthSpendUsd("t1")).toBe(0);
  });
});
