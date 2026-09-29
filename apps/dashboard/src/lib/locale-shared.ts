/**
 * أدوات اللغة النقية — مشتركة بين الخادم والعميل بلا توجيه "use client".
 *
 * لماذا وحدة مستقلة: ملف locale-state عميل بالكامل، واستدعاء دواله من
 * مكونات خادمية ممنوع في React Server Components. كل ما هو حسابي محض
 * (dir/normalize/اسم الكوكي) يعيش هنا فيستخدمه الخادم بأمان.
 */

export type Locale = "ar" | "en";

/** اسم كوكي اللغة — يقرأه الخادم لتوليد html lang/dir الصحيحين منذ أول بايت */
export const LOCALE_COOKIE = "ab-locale";

export function dir(locale: Locale): "rtl" | "ltr" {
  return locale === "ar" ? "rtl" : "ltr";
}

/** يقبل فقط القيمتين المعروفتين — أي شيء آخر يعود للعربية الافتراضية */
export function normalizeLocale(value: string | undefined | null): Locale {
  return value === "en" ? "en" : "ar";
}
