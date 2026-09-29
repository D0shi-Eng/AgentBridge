/**
 * إطار RLS الإلزامي — كل استعلام على جدول مشترك يمر عبر معاملة واحدة
 * تضبط `set_config(..., true)` أولاً ثم تنفذ العمل داخلها حصراً.
 *
 * كيف يعمل: المحولات الحية تنادي withTenantPrisma/withLookupPrisma في كل
 * عملية؛ الدالتان تفتحان معاملة تفاعلية واحدة ويستقبل العمل عميل المعاملة
 * نفسه، فلا طريق بديل يفصل ضبط السياق عن الاستعلام. القيم تُمرر
 * parameterized عبر $executeRawUnsafe لا بالتسلسل النصي.
 *
 * فحص الإقلاع fail-closed الموسّع مقسوم إلى prisma-scope-hardening.ts
 * لالتزام حد 150 سطراً للملف.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

/** إعادة التصدير: الرمز الشرعي الوحيد لفحص الإقلاع (يشترك مساه من resolve-stores) */
export { assertRestrictedRole } from "./prisma-scope-hardening.js";

/** المفاتيح المسموح ضبطها في منافذ pre-auth فقط — خارجها رفض صريح */
export const LOOKUP_KEYS: ReadonlySet<string> = new Set([
  "app.tenant_id",
  "app.credential_id", "app.identity_issuer", "app.identity_subject",
  "app.session_hash", "app.state_hash", "app.verification_id",
  "app.identity_write",
  // سياق حذف المستأجر: يضعه سير الحذف حصراً لفتح قراءة الهويات
  // الداخلية المقيّدة بسياسة identity_deletion_lookup
  "app.deletion_context",
]);

/** إعداد واحد: مفتاح وقيمته — كلاهما parameterized لا ملصوق بالنص */
export type ScopedSetting = readonly [key: string, value: string];

/** العمل المنفذ داخل معاملة RLS مضبوطة */
type ScopedWork<T> = (transaction: Prisma.TransactionClient) => Promise<T>;

/** يرفض أي سياق فارغ قبل فتح المعاملة — لا استعلام بلا نطاق إطلاقاً */
function assertValidSettings(settings: readonly ScopedSetting[]): void {
  if (settings.length === 0) throw new Error("سياق قاعدة البيانات فارغ — رفض تنفيذ استعلام بلا نطاق");
  for (const [key, value] of settings) {
    if (key.length === 0 || value.length === 0) throw new Error("سياق قاعدة البيانات غير صالح: مفتاح أو قيمة فارغة");
  }
}


/**
 * معاملة tenant واحدة: يضبط app.tenant_id ثم ينفذ العمل على عميل المعاملة.
 * هذا هو المسار الإلزامي لكل عملية على جداول ذات عمود tenant_id.
 */
export function withTenantPrisma<T>(client: PrismaClient, tenantId: string, work: ScopedWork<T>): Promise<T> {
  return scopedTransaction(client, [["app.tenant_id", tenantId]], work);
}

/**
 * معاملة pre-auth ضيقة: المفاتيح من القائمة البيضاء فقط، وكل سياسة RLS
 * المطابقة تطابق قيمة GUC واحدة بالتحديد — لا مسح عريض أبداً.
 */
export function withLookupPrisma<T>(client: PrismaClient, settings: readonly ScopedSetting[], work: ScopedWork<T>): Promise<T> {
  for (const [key] of settings) {
    if (!LOOKUP_KEYS.has(key)) throw new Error(`مفتاح lookup غير مسموح: ${key}`);
  }
  return scopedTransaction(client, settings, work);
}

/** الجوهر المشترك: معاملة واحدة، ضبط السياق أولاً، ثم العمل داخلها */
function scopedTransaction<T>(client: PrismaClient, settings: readonly ScopedSetting[], work: ScopedWork<T>): Promise<T> {
  assertValidSettings(settings);
  return client.$transaction(async (transaction) => {
    for (const [key, value] of settings) {
      await transaction.$executeRawUnsafe("SELECT set_config($1, $2, true)", key, value);
    }
    return work(transaction);
  });
}
