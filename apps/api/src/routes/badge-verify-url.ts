/**
 * بناء رابط التحقق لرصد الشارة — الأصل مصدره الإعداد الموثوق حصراً.
 *
 * القرار الأمني: الأصل مصدره إعداد الخادم الموثوق (APP_ORIGIN) حصراً.
 * قبل الإصلاح كان ?verifyUrl= من الاستعلام يقبل رابطاً خارجياً — تسمم
 * يوجه من يفحص الشارة إلى خادم مهاجم. الآن لا ترويسة Host ولا
 * X-Forwarded-* ولا معامل query يُقرأ هنا أصلاً؛ الوظيفة نقية
 * تستقبل الإعداد ورقم التحقق فتُختبر بلا HTTP.
 */
import type { AppConfig } from "@agentbridge/infra";

/** يبني رابط التحقق من الأصل الموثوق فقط — لا مدخل من الطلب مهما كان */
export function buildVerifyUrl(config: AppConfig, verificationId: string): string {
  return new URL(`/verify/${encodeURIComponent(verificationId)}`, config.appOrigin).toString();
}
