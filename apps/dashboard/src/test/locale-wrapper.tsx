import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { LocaleProvider, type Locale } from "@/lib/locale-state";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { SessionProvider } from "@/lib/use-session";

/** غلاف مزودات الاختبار: لغة + تنبيهات — بلا جلسة (تُزوَّر عند الحاجة) */
export function TestProviders({ locale = "ar", children }: { locale?: Locale; children: React.ReactNode }) {
  return (
    <LocaleProvider initialLocale={locale}>
      <ToastProvider>{children}</ToastProvider>
    </LocaleProvider>
  );
}

/** يرسم شجرة داخل مزود اللغة فقط — للمكونات التي لا تستخدم التنبيهات */
export function renderWithLocale(
  ui: React.ReactElement,
  options: { locale?: Locale; renderOptions?: Omit<RenderOptions, "wrapper"> } = {},
): ReturnType<typeof render> {
  const locale = options.locale ?? "ar";
  function Wrapper({ children }: { children: React.ReactNode }) {
    return <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>;
  }
  return render(ui, { wrapper: Wrapper, ...options.renderOptions });
}

/**
 * يرسم داخل كل المزودات مع الجلسة — لصفحات اللوحة في الاختبارات.
 * مزود الجلسة يجيب /auth/session عبر fetch المزوَّر في كل spec.
 */
export function renderWithProviders(
  ui: React.ReactElement,
  options: { locale?: Locale; renderOptions?: Omit<RenderOptions, "wrapper"> } = {},
): ReturnType<typeof render> {
  const locale = options.locale ?? "ar";
  function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <LocaleProvider initialLocale={locale}>
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </LocaleProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options.renderOptions });
}
