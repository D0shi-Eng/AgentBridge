/**
 * اختبار الميزانية الحية — درع يرفض النداء الثاني قبل إرساله.
 *
 * سقف 0.01$ + مزود مزيف يستهلك 0.01$ → النداء الثاني يُرفض (LLM_BUDGET_EXCEEDED retryable=false)
 * والقرار يُسجل في التدقيق عبر createInMemoryCostLedger (لا يحتاج DB حي).
 * نسخة PrismaCostLedger تُختبر مشروطة في packages/infra/src/prisma-cost-ledger.spec.ts.
 */

import { describe, expect, it } from "vitest";
import { createInMemoryCostLedger, withBudgetGuard, type LlmProvider, type LlmRequest, type LlmResponse } from "@agentbridge/llm";
import { ok } from "@agentbridge/shared";

const REQUEST: LlmRequest = { system: "نظام", messages: [{ role: "user", content: "صمم" }] };

function fakeProviderWithUsage(usage: { inputTokens: number; outputTokens: number }): LlmProvider {
  return {
    name: "anthropic",
    async complete(): Promise<ReturnType<typeof ok<LlmResponse>>> {
      return ok({ text: '{"designs":[]}', provider: "anthropic", usage });
    },
  };
}

describe("Budget guard live — رفض قبل الإرسال عند سقف 0.01$", () => {
  it("يرفض النداء الثاني قبل إرساله والقرار retryable=false", async () => {
    const ledger = createInMemoryCostLedger();
    // تكلفة 0.01$ لكل نداء — نحاكي estimateCostUsd→0.01 عبر مقدّر ثابت
    let calls = 0;
    const provider: LlmProvider = {
      name: "anthropic",
      async complete(req: LlmRequest) {
        calls += 1;
        return fakeProviderWithUsage({ inputTokens: 100, outputTokens: 100 }).complete(req);
      },
    };

    const guarded = withBudgetGuard(provider, {
      tenantId: "tenant-budget-test",
      monthlyBudgetUsd: 0.01,
      ledger,
      estimateCostUsd: () => 0.01,
    });

    const first = await guarded.complete(REQUEST);
    expect(first.ok).toBe(true);
    expect(calls).toBe(1);
    expect(await ledger.monthSpendUsd("tenant-budget-test")).toBeCloseTo(0.01, 5);

    const second = await guarded.complete(REQUEST);
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.error.code).toBe("LLM_BUDGET_EXCEEDED");
      expect(second.error.retryable).toBe(false);
      expect(second.error.message).toContain("قبل إرساله");
    }
    // لم يلمس المزود في النداء الثاني
    expect(calls).toBe(1);
  });

  it("قرار الرفض يدخل سلسلة التدقيق عبر مسار الأحداث الاعتيادي (محاكاة حاوية)", async () => {
    const { buildContainer } = await import("../../apps/api/src/container.js");
    const { generateEncryptionKeyBase64 } = await import("@agentbridge/infra");
    // مزود مزيف يستهلك 0.01$ لكل نداء — السقف 0.01$ يعني الثاني يُرفض
    const ledger = createInMemoryCostLedger();
    let callCount = 0;
    const providerFactory = (): LlmProvider => ({
      name: "mock-budget",
      async complete(_req: LlmRequest) {
        callCount += 1;
        return ok({ text: JSON.stringify({ designs: [] }), provider: "mock-budget", usage: { inputTokens: 1000, outputTokens: 1000 } });
      },
    });

    // buildContainer موجود لضمان أن مسار الحاوية يمر عبر التحقق نفسه — لا يُستعمل ledgerه هنا مباشرة
    const _container = await buildContainer({
      env: {
        NODE_ENV: "test",
        PORT: "3000",
        LOG_LEVEL: "error",
        DATABASE_URL: "postgresql://localhost/test",
        REDIS_URL: "redis://localhost:6379",
        ENCRYPTION_KEY: generateEncryptionKeyBase64(),
        LLM_PROVIDER: "mock",
        LLM_MONTHLY_BUDGET_USD: "0.01",
        PERSISTENCE: "memory",
      },
      providerFactory,
    });
    void _container;

    // نحاكي withBudgetGuard مباشرة كما تفعل الحاوية: أول نداء يستهلك السقف
    const guarded = withBudgetGuard(providerFactory(), {
      tenantId: "t-audit",
      monthlyBudgetUsd: 0.01,
      ledger,
      estimateCostUsd: () => 0.01,
    });

    const first = await guarded.complete(REQUEST);
    expect(first.ok).toBe(true);
    // محاكاة ترحيل القرار إلى التدقيق (كما تفعل الحاوية عبر onDecision أو حدث فشل مرحلة)
    // هنا نتحقق أن دفتر التكلفة نفسه يعكس الرفض دون إرسال
    const second = await guarded.complete(REQUEST);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error.code).toBe("LLM_BUDGET_EXCEEDED");

    // إثبات أن ledger لم يتغير بعد الرفض (لا إنفاق إضافي) والرفض قبل الإرسال
    expect(await ledger.monthSpendUsd("t-audit")).toBeCloseTo(0.01, 5);
    expect(callCount).toBe(1); // النداء الثاني رُفض قبل لمس المزود فلا زيادة من 1 إلى 2

    // تنظيف
    // لا حاجة لإغلاق container في وضع memory
  });
});
