"use client";

/**
 * زر تبديل اللغة — يكتب الكوكي وlocalStorage وhtml dir بلا إعادة تحميل.
 *
 * كيف: setLocale من المزود الموحد (مصدر واحد)؛ التسمية تعرض
 * اللغة الأخرى (القاعدة المتبعة في المنتجات ثنائية الاتجاه).
 */

import { t, useLocale } from "@/lib/i18n";

export function LocaleToggle() {
  const { locale, setLocale } = useLocale();
  const next = locale === "ar" ? "en" : "ar";
  const label = t(next === "en" ? "locale.targetEnglish" : "locale.targetArabic", locale);
  const aria = t(locale === "ar" ? "locale.switchToEnglish" : "locale.switchToArabic", locale);
  return (
    <button
      type="button"
      aria-label={aria}
      className="btn ghost sm"
      onClick={() => setLocale(next)}
    >
      {label}
    </button>
  );
}
