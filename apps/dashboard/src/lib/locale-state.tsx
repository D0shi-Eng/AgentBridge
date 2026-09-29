"use client";

/**
 * حالة اللغة — مصدر واحد حقيقي للواجهة كلها.
 *
 * ماهيتها: سياق React + مزود عميل يغذى من قيمة الخادم (الكوكي) عند الترطيب،
 * فلا وميض اتجاه ولا mismatch: الخادم والعميل يبدآن من الرقم نفسه.
 * وظيفتها: useLocale() يقرأ، وsetLocale() يكتب الكوكي (لأجل SSR القادم)
 * وlocalStorage (لأجل مزامنة التبويبات) وخصال html lang/dir فوراً.
 * الأدوات النقية (dir/normalize/اسم الكوكي) في locale-shared — هذا الملف
 * عميل بالكامل فلا يُستدعى من مكونات خادمية.
 */

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { LOCALE_COOKIE, dir, normalizeLocale, type Locale } from "./locale-shared";

export { dir, LOCALE_COOKIE, normalizeLocale, type Locale } from "./locale-shared";

const LOCALE_STORAGE = "ab-locale";

interface LocaleContextValue {
  readonly locale: Locale;
  setLocale: (next: Locale) => void;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

/**
 * يكتب اللغة في الكوكي بخصائص آمنة — ليست HttpOnly لأن العميل
 * هو من يكتبها عند التبديل، وليست سراً إطلاقاً (تفضيل واجهة فقط).
 */
function persistLocale(next: Locale): void {
  const maxAge = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
  try {
    window.localStorage.setItem(LOCALE_STORAGE, next);
  } catch {
    // فشل التخزين المحلي لا يمنع التبديل — الكوكي كافية للSSR القادم
  }
}

export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // خصال html تتبع الحالة دائماً — بما فيها بعد التبديل بلا إعادة تحميل
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = dir(locale);
  }, [locale]);

  // مزامنة التبويبات الأخرى عبر storage — الحدث الوحيد المعتمد
  useEffect(() => {
    const sync = (event: StorageEvent): void => {
      if (event.key === LOCALE_STORAGE && (event.newValue === "ar" || event.newValue === "en")) {
        setLocaleState(event.newValue);
      }
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      setLocale: (next) => {
        setLocaleState(next);
        persistLocale(next);
      },
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** هوك القراءة الوحيد — كل المكونات منه بلا استثناء (لا حالة لغة محلية) */
export function useLocale(): LocaleContextValue {
  const value = useContext(LocaleContext);
  if (value === null) throw new Error("useLocale خارج LocaleProvider — غلّف التطبيق بالمزود");
  return value;
}

/** يقرأ لغة التبويب الحالية من localStorage — للاستخدامات التي تسبق السياق */
export function readStoredLocale(): Locale {
  try {
    return normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE));
  } catch {
    return "ar";
  }
}
