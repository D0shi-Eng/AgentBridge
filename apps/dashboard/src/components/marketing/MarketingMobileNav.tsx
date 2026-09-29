"use client";

/**
 * تنقل الموقع التسويقي على الجوال — قائمة إفصاح عمودية بدل شريط
 * مكتبي مزدحم داخل 390px. نفس نمط لوحة AppShell: زر hamburger بارتفاع لمس
 * 44px، aria-expanded، Escape يغلق ويعيد التركيز، قفل تمرير الصفحة، وإغلاق
 * عند اختيار مرساة. الروابط تظل مراسي الأقسام نفسها (لا تغيير معنى).
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { t, useLocale } from "@/lib/i18n";
import { LocaleToggle } from "@/components/LocaleToggle";

const SECTION_LINKS = [
  { href: "/#how", key: "nav.marketing.how" },
  { href: "/#security", key: "nav.marketing.security" },
  { href: "/#open-source", key: "nav.marketing.opensource" },
  { href: "/#faq", key: "nav.marketing.faq" },
] as const;

export function MarketingMobileNav() {
  const { locale } = useLocale();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Escape يغلق ويعيد التركيز للزر + قفل تمرير الجسم أثناء الفتح (نفس عقد AppShell)
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <div className="mnav-root">
      <button
        ref={toggleRef}
        type="button"
        className="mnav-toggle"
        aria-expanded={open}
        aria-controls="mnav-panel"
        aria-label={t(open ? "common.closeMainMenu" : "common.openMainMenu", locale)}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true">{open ? "✕" : "☰"}</span>
      </button>
      {open && (
        <nav id="mnav-panel" className="mnav-panel" aria-label={t("nav.main", locale)}>
          {SECTION_LINKS.map((link) => (
            <a key={link.href} href={link.href} onClick={() => setOpen(false)}>
              {t(link.key, locale)}
            </a>
          ))}
          <div className="mnav-row">
            <LocaleToggle />
            <Link href="/app" className="btn green mnav-cta" onClick={() => setOpen(false)}>
              {t("nav.openDashboard", locale)}
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}
