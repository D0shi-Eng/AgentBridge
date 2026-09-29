import type { Metadata } from "next";
import { cookies } from "next/headers";
import "./globals.css";
import { t } from "@/lib/i18n";
import { LocaleProvider } from "@/lib/locale-state";
import { LOCALE_COOKIE, dir, normalizeLocale, type Locale } from "@/lib/locale-shared";
import { ToastProvider } from "@/components/ui/ToastProvider";
import { plexSansArabic, interLatin } from "@/fonts/fonts";

/**
 * الجذر الموحد — لغة العرض من كوكي `ab-locale` فتولَّد خصال html lang/dir
 * الصحيحتان من الخادم منذ أول رسم (لا ثورة ولا وميض).
 * الكوكي تفضيل عرض بلا هوية؛ غيابها يعني العربية الافتراضية.
 * مزود التنبيهات هنا فيغطي الموقع التسويقي واللوحة معاً.
 */

/** يجيب لغة التبويب من كوكي الطلب — داخلية للجذر (Next يصرح بتصديرات layout) */
function localeFromCookieValue(value: string | undefined): Locale {
  return normalizeLocale(value);
}

export async function generateMetadata(): Promise<Metadata> {
  const store = await cookies();
  const locale = localeFromCookieValue(store.get(LOCALE_COOKIE)?.value);
  const title =
    locale === "ar"
      ? "AgentBridge — خوادم MCP قابلة للمراجعة من مواصفات OpenAPI"
      : "AgentBridge — reviewable MCP servers from OpenAPI specifications";
  const description = t("marketing.heroSub", locale);
  return {
    title: { default: title, template: "%s · AgentBridge" },
    description,
    openGraph: {
      type: "website",
      locale: locale === "ar" ? "ar_SA" : "en_US",
      siteName: "AgentBridge",
      title,
      description,
      images: [{ url: "/og.png", width: 1200, height: 630, alt: "AgentBridge" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og.png"],
    },
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const locale = localeFromCookieValue(store.get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} dir={dir(locale)} className={`${plexSansArabic.variable} ${interLatin.variable}`}>
      <body>
        <LocaleProvider initialLocale={locale}>
          <ToastProvider>{children}</ToastProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
