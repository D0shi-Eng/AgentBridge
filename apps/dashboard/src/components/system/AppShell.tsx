"use client";

/**
 * قشرة التطبيق الموحدة — ترويسة واحدة وروابط واحدة لكل صفحات اللوحة.
 *
 * ماهيتها: عميل يقرأ الجلسة من SessionProvider (بلا نداء إضافي) وusePathname
 * للحالة النشطة. لا ينشئ حالة، ولا يعرف شيئاً عن منطق الصفحات.
 * وظيفتها: تنقل متسق بحالة نشطة، تبديل لغة، قائمة جوال بلا مأسر تركيز
 * (التنقل لا يحبس التركيز — زر يفتح ويغلق ويستعيد التركيز عند الإغلاق
 * بمفتاح Escape)، ومساحة مستخدم مع خروج واضح.
 * الوضع المحلي الفردي: لا هوية بديلة للتبديل إليها فيُخفى زر الخروج —
 * إنهاء الجلسة فعلياً هو إغلاق المتصفح، والعودة تأسسها تلقائياً.
 * الأمن: إخفاء روابط الإعدادات عن غير المخول تيسير عرض فقط — التفويض
 * الحقيقي يبقى في الخادم (صلاحية sso:manage من الجلسة).
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { t, useLocale } from "@/lib/i18n";
import { useSession } from "@/lib/use-session";
import { LocaleToggle } from "@/components/LocaleToggle";
import { Logo } from "@/components/ui/Logo";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";

/** روابط التنقل الرئيسية — لا عنصر لمسار غير موجود فعلاً في التطبيق */
interface NavItem {
  readonly href: string;
  readonly key: "nav.dashboard" | "nav.flywheel" | "nav.analytics" | "nav.ops" | "nav.sso";
  /** صلاحية العرض فقط — التفويض الحقيقي في الخادم دائماً */
  readonly permission?: string;
}
const NAV_ITEMS: readonly NavItem[] = [
  { href: "/app", key: "nav.dashboard" },
  { href: "/flywheel", key: "nav.flywheel" },
  { href: "/flywheel/analytics", key: "nav.analytics" },
  { href: "/ops", key: "nav.ops" },
  { href: "/settings/sso", key: "nav.sso", permission: "sso:manage" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { locale } = useLocale();
  const { session, replace } = useSession();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  // قرار إخفاء الخروج من الخادم حصراً (نقطة عامة تعرف التفعيل لا أكثر)
  const [localMode, setLocalMode] = useState(false);

  useEffect(() => {
    let alive = true;
    void api.localMode().then((mode) => { if (alive && mode !== null) setLocalMode(mode.enabled); });
    return () => { alive = false; };
  }, []);

  // إغلاق قائمة الجوال بمفتاح Escape واستعادة التركيز للزر — نمط disclosure
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  // قفل تمرير الصفحة ما دامت قائمة الجوال مفتوحة (تغطي المحتوى)
  useEffect(() => {
    if (menuOpen === false) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [menuOpen]);

  // إغلاق القائمة عند التنقل حتى لا تظل تغطي المحتوى الجديد
  useEffect(() => { setMenuOpen(false); }, [pathname]);

  const canManageSso = session?.permissions?.includes("sso:manage") === true;

  async function signOut(): Promise<void> {
    try { await api.logout({ tenantId: session?.tenantId ?? "" }); } finally {
      replace(null);
      toast.info(t("nav.signedOutToast", locale));
    }
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t("common.skipToContent", locale)}</a>
      <header className="app-header">
        <div className="app-header-row">
          <Link href="/app" className="brand" style={{ color: "var(--text)", textDecoration: "none" }}>
            <Logo />
            {t("common.appName", locale)}
          </Link>
          {/* زر أيقونة مدمج — الاسم الظاهر للبصر أيقونة، والاسم الوصفي aria-label */}
          <button
            ref={toggleRef}
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="app-main-nav"
            aria-label={menuOpen ? t("common.closeMainMenu", locale) : t("common.openMainMenu", locale)}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              {menuOpen ? (
                <path d="M6 6 L18 18 M18 6 L6 18" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              ) : (
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              )}
            </svg>
          </button>
          <nav id="app-main-nav" className="app-nav" data-open={menuOpen ? "true" : "false"} aria-label={t("nav.main", locale)}>
            {NAV_ITEMS.map((item) => {
              if (item.permission !== undefined && !canManageSso) return null;
              // الحالة النشطة: تطابق تام أو كون المسار الحالي ولداً من هذا القسم
              const active = pathname === item.href || (item.href !== "/app" && pathname.startsWith(`${item.href}/`));
              return (
                <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
                  {t(item.key, locale)}
                </Link>
              );
            })}
            {/* الحساب واللغة داخل القائمة على الجوال — رأس مضغوط */}
            <div className="nav-menu-meta">
              <LocaleToggle />
              {session !== null && (
                <>
                  {/* الوضع المحلي: عبارة مفهومة بدل المعرّف الداخلي — القيمة الخام تبقى في التلميح */}
                  <span className="user-chip" title={session.tenantId}>
                    {localMode ? t("nav.localWorkspace", locale) : <>{t("nav.tenantLabel", locale)}: <b>{session.tenantId}</b></>}
                  </span>
                  {!localMode && (
                <Button variant="ghost" size="sm" onClick={() => void signOut()}>{t("nav.signOut", locale)}</Button>
              )}
                </>
              )}
            </div>
          </nav>
          {/* شريط المستخدم المكتبي — يختفي على الجوال عبر CSS لصالح القائمة */}
          {session !== null && (
            <div className="user-chip user-chip-desktop" aria-label={t("nav.userArea", locale)}>
              <span aria-hidden="true">·</span>
              <span className="tenant-truncate" title={session.tenantId}>
                {localMode ? t("nav.localWorkspace", locale) : <>{t("nav.tenantLabel", locale)}: <b>{session.tenantId}</b></>}
              </span>
              {!localMode && (
                <Button variant="ghost" size="sm" onClick={() => void signOut()}>{t("nav.signOut", locale)}</Button>
              )}
            </div>
          )}
        </div>
      </header>
      <div id="main-content">{children}</div>
    </div>
  );
}

/** مسار تنقل بسيط وصولي — ol بـaria-label والعنصر الأخير حالته aria-current */
export function Breadcrumbs({ items }: { items: ReadonlyArray<{ label: string; href?: string }> }) {
  const { locale } = useLocale();
  return (
    <nav className="breadcrumbs" aria-label={t("breadcrumb.label", locale)} style={{ marginBottom: "var(--space-15)" }}>
      <ol>
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${String(index)}`}>
              {item.href !== undefined && !last
                ? <a href={item.href}>{item.label}</a>
                : <span aria-current={last ? "page" : undefined}>{item.label}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
