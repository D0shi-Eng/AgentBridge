/**
 * واجهة التدويل العامة — نقطة الاستيراد للصفحات والمكونات.
 *
 * كيف: يعيد تصدير t() من i18n/ والهوكات من locale-state حتى تبقى
 * مسارات الاستيراد القديمة (مثل @/lib/i18n) صحيحة بلا تكرار منطق.
 */

import { t as translate, type UiKey } from "./i18n/index";
import { ApiError } from "./api-client";
import type { Locale } from "./locale-shared";
import { errorKeyForCode } from "./error-codes";

export { t, LOCALES, type UiKey } from "./i18n/index";
// الأدوات النقية من locale-shared (آمنة للخادم)، وأدوات السياق من locale-state (عميل)
export { dir, LOCALE_COOKIE, normalizeLocale, type Locale } from "./locale-shared";
export { useLocale, LocaleProvider, readStoredLocale } from "./locale-state";
export { errorKeyForCode } from "./error-codes";

/**
 * رسالة خطأ جاهزة للعرض — عقد الأكواد :
 * الخادم يعيد `code` ثابتاً فتترجمه الواجهة حسب اللغة، ولا يُعرض نص
 * الرسالة الخام من الخادم إطلاقاً (قد يكون بلغة المستخدم الأخرى أو
 * يحمل تفاصيل داخلية). كود غير معروف → رسالة عامة مترجمة مع الكود
 * التقني وحده (معرف ثابت لا يكشف شيئاً).
 */
export function apiErrorMessage(error: unknown, locale: Locale, fallback: UiKey): string {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code !== undefined && !/^HTTP_\d+$/u.test(code)) {
    const key = errorKeyForCode(code);
    if (key !== undefined) return translate(key, locale);
    return translate("error.unknownCode", locale, { code });
  }
  // أخطاء شبكة بلا كود خادم (فشل fetch) → fallback المترجم
  return translate(fallback, locale);
}

/**
 * ترجمة سبب عدم منح الشهادة من رمزه الهيكلي — النص الخام من الخادم
 * لا يُعرض إطلاقاً؛ الرمز غير المعروف يعود لرسالة موحدة مترجمة.
 */
export function certDeniedReasonText(code: string | undefined, locale: Locale): string {
  const key: UiKey = (code !== undefined && code in codeSentinel)
    ? (`run.certDeniedCode.${code}` as UiKey)
    : "run.certDeniedCode.UNKNOWN";
  return translate(key, locale);
}

/** حراس الأنواع: مفاتيح أكواد الرفض المعروفة للقاموس */
const codeSentinel = {
  CRITICAL_FINDINGS: true,
  SCORE_BELOW_THRESHOLD: true,
  LIVE_EVIDENCE_MISSING: true,
  LIVE_EVIDENCE_HASH_MISMATCH: true,
  LIVE_EVIDENCE_INCOMPLETE: true,
  SANDBOX_EVIDENCE_INVALID: true,
} as const;
