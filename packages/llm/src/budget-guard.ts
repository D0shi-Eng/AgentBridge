/**
 * درع ميزانية النماذج — العقد والتكلفة فقط.
 *
 * القاعدة: أي نداء نموذج يُرفض **قبل إرساله** حين تكون تكلفة الشهر الجاري
 * قد بلغت السقف (LLM_MONTHLY_BUDGET_USD). الدفتر CostLedger منفذ ضيق
 * يستبدل لاحقاً بصفوف L2 دائمة؛ الحالي داخل الذاكرة كافٍ لأن المجيب
 * الوحيد المتاح الآن (mock) كلفته صفر.
 *
 * قرار الحارس يخرج عبر onDecision لمن يريد ترحيله إلى سلسلة التدقيق،
 * والرفض نفسه يعيد Result فلا يُرمى استثناءً — قرارات المنسق تتولى
 * تصنيفه كفشل مرحلة يدخل السلسلة عبر مسار الأحداث الاعتيادي.
 */

import type { Result } from "@agentbridge/shared";
import { AppError } from "@agentbridge/shared";
import type { LlmProvider, LlmRequest, LlmResponse } from "./provider.js";

/** دفتر التكلفة الشهرية لكل مستأجر — يُستبدل بتنفيذ L2 عند أول مزود مدفوع */
export interface CostLedger {
  /** مجموع الإنفاق المسجل للشهر الجاري بالدولار */
  monthSpendUsd(tenantId: string): Promise<number>;
  /** يسجل إنفاقاً جديداً على حساب المستأجر */
  addSpend(tenantId: string, amountUsd: number): Promise<void>;
}

/** دفتر داخل الذاكرة — للتطوير والاختبار ومزودي الصفر تكلفة */
export function createInMemoryCostLedger(): CostLedger {
  const byTenant = new Map<string, number>();
  return {
    async monthSpendUsd(tenantId) {
      return byTenant.get(tenantId) ?? 0;
    },
    async addSpend(tenantId, amountUsd) {
      byTenant.set(tenantId, (byTenant.get(tenantId) ?? 0) + amountUsd);
    },
  };
}

/** قرار واحد موثق من درع الميزانية */
export interface BudgetDecision {
  readonly allowed: boolean;
  readonly tenantId: string;
  readonly spendUsd: number;
  readonly budgetUsd: number;
  /** شرح عربي مختصر — يصلح قيمة ملخص تدقيق */
  readonly reason: string;
}

export interface BudgetGuardOptions {
  readonly tenantId: string;
  readonly monthlyBudgetUsd: number;
  readonly ledger: CostLedger;
  /** مراقب القرار — الحاوية ترحله إلى سلسلة التدقيق */
  readonly onDecision?: (decision: BudgetDecision) => void;
  /**
   * مقدر كلفة النداء بالدولار — مزودو S10 سيقدمون استهلاك الرموز فعلياً؛
   * الافتراضي صفر حتى لا يُحتال على الأرقام بتخمين مبكر.
   */
  readonly estimateCostUsd?: (request: LlmRequest, response: LlmResponse) => number;
}

/** يلفط مزوداً بأي درع الميزانية — نفس العقد فلا يتغير شيء مستهلك */
export function withBudgetGuard(provider: LlmProvider, options: BudgetGuardOptions): LlmProvider {
  const { tenantId, monthlyBudgetUsd, ledger, onDecision, estimateCostUsd } = options;
  return {
    name: `${provider.name}+budget`,
    async complete(request: LlmRequest): Promise<Result<LlmResponse>> {
      const spendUsd = await ledger.monthSpendUsd(tenantId);
      if (spendUsd >= monthlyBudgetUsd) {
        const decision: BudgetDecision = {
          allowed: false,
          tenantId,
          spendUsd,
          budgetUsd: monthlyBudgetUsd,
          reason: `رُفض النداء قبل إرساله: إنفاق الشهر ${spendUsd.toFixed(2)}$ بلغ السقف ${monthlyBudgetUsd.toFixed(2)}$`,
        };
        onDecision?.(decision);
        return {
          ok: false,
          error: new AppError("LLM_BUDGET_EXCEEDED", decision.reason, false, "warning"),
        };
      }

      const response = await provider.complete(request);
      if (response.ok && estimateCostUsd !== undefined) {
        await ledger.addSpend(tenantId, estimateCostUsd(request, response.value));
      }
      onDecision?.({
        allowed: true,
        tenantId,
        spendUsd,
        budgetUsd: monthlyBudgetUsd,
        reason: `سُمح بنداء ضمن السقف: الإنفاق ${spendUsd.toFixed(2)}$ من ${monthlyBudgetUsd.toFixed(2)}$`,
      });
      return response;
    },
  };
}
