/**
 * مبدئو صفوف الفوترة — دفتر LlmSpend والمفاتيح الشهرية.
 *
 * ماهيتها: تحويلات نقية بين تمثيل النطاق ومخطط Prisma لجدول llm_spend.
 * وظيفتها: يغذي PrismaCostLedger دون أن يعرف شكل السجل النطاقي البتة.
 * كيف: دالة currentMonthKey تستخرج YYYY-MM من ISO حتمياً، والواجهة LlmSpendRow
 * مطابقة لأسماء snake_case في القاعدة.
 */

/** صف llm_spend — دفتر التكلفة الشهري */
export interface LlmSpendRow {
  readonly tenant_id: string;
  readonly month: string;
  readonly amount_usd: number;
}

export function currentMonthKey(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}
