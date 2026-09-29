/**
 * دفتر التكلفة الدائم — ينفذ CostLedger فوق جدول llm_spend.
 *
 * القاعدة الملزمة كسائر محولات L2: جسمه نداءات delegate رفيعة
 * + مبدئو الصفوف النقية (currentMonthKey) حصراً — صفر منطق نطاق.
 * كل عملية عبر معاملة RLS تضبط app.tenant_id أولاً وتنفذ
 * العمل على TransactionClient نفسه — عميل الجذر لا يلمس الجدول.
 * month = YYYY-MM من UTC، المجموع والشهر الحالي فقط.
 */

import { PrismaClient } from "@prisma/client";
import type { CostLedger } from "@agentbridge/llm";
import { currentMonthKey } from "./billing-mappers.js";
import { withTenantPrisma } from "./prisma-scope.js";

export function createPrismaCostLedger(client: PrismaClient): CostLedger {
  return {
    async monthSpendUsd(tenantId: string): Promise<number> {
      const month = currentMonthKey();
      const rows = await withTenantPrisma(client, tenantId, (tx) =>
        tx.llmSpend.findMany({ where: { tenant_id: tenantId, month } }));
      return rows.reduce((sum, row) => sum + row.amount_usd, 0);
    },

    async addSpend(tenantId: string, amountUsd: number): Promise<void> {
      const month = currentMonthKey();
      await withTenantPrisma(client, tenantId, async (tx) => {
        await tx.llmSpend.upsert({
          where: { tenant_id_month: { tenant_id: tenantId, month } },
          update: { amount_usd: { increment: amountUsd } },
          create: { tenant_id: tenantId, month, amount_usd: amountUsd },
        });
      });
    },
  };
}
