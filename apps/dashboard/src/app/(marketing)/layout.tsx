import Link from "next/link";
import { cookies } from "next/headers";
import { t } from "@/lib/i18n";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/locale-shared";
import { Logo } from "@/components/ui/Logo";
import { LocaleToggle } from "@/components/LocaleToggle";
import { MarketingMobileNav } from "@/components/marketing/MarketingMobileNav";

/**
 * هيكل الموقع التسويقي — ترويسة لاصقة وتذييل مع زر تبديل اللغة، بلا أي بوابة دخول.
 * الروابط كلها مراسٍ داخل الصفحة أو للوحة/التحقق؛ التبديل يغيّر dir بلا إعادة
 * تحميل، ولغة المحتوى من كوكي الطلب فيولد الخادم النص الصحيح منذ البداية.
 * الشريط المكتبي يختفي داخل الجوال ويحل محله قائمة إفصاح 44px،
 * وشارة التذييل تمر عبر القاموس (لا نص إنجليزي صلب في واجهة عربية).
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <>
      {/* رابط التجاوز موحّد مع اللوحة: أول بؤرة بلوحة المفاتيح */}
      <a className="skip-link" href="#main-content">{t("common.skipToContent", locale)}</a>
      <header className="site-header">
        <div className="container-wide site-nav">
          <Link href="/" className="brand" style={{ color: "var(--text)", textDecoration: "none" }}>
            <Logo />
            AgentBridge
          </Link>
          <nav className="nav-links nav-links-desktop" aria-label={t("nav.main", locale)}>
            <a href="/#how">{t("nav.marketing.how", locale)}</a>
            <a href="/#security">{t("nav.marketing.security", locale)}</a>
            <a href="/#open-source">{t("nav.marketing.opensource", locale)}</a>
            <a href="/#faq">{t("nav.marketing.faq", locale)}</a>
            <LocaleToggle />
            <Link href="/app" className="btn green sm">
              {t("nav.openDashboard", locale)}
            </Link>
          </nav>
          <MarketingMobileNav />
        </div>
      </header>
      <div id="main-content">{children}</div>
      <footer className="site-footer">        <div className="container-wide footer-grid">
          <span>{t("marketing.footerTagline", locale)}</span>
          <span className="mono">{t("marketing.footerBadge", locale)}</span>
        </div>
      </footer>
    </>
  );
}
