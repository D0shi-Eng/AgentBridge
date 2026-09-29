import { cookies } from "next/headers";
import { t } from "@/lib/i18n";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/locale-shared";

/** قسم الأسئلة الشائعة — إجابات صادقة عن طبيعة المشروع وحالته الفعلية */

const FAQS = [
  { qKey: "marketing.faq1q", aKey: "marketing.faq1a" },
  { qKey: "marketing.faq2q", aKey: "marketing.faq2a" },
  { qKey: "marketing.faq3q", aKey: "marketing.faq3a" },
  { qKey: "marketing.faq4q", aKey: "marketing.faq4a" },
  { qKey: "marketing.faq5q", aKey: "marketing.faq5a" },
] as const;export async function FaqSection() {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <section className="section section-alt" id="faq">
      <div className="container-wide">
        <div className="section-head">
          <h2 className="section-title">{t("marketing.faqTitle", locale)}</h2>
        </div>
        <div className="faq">
          {FAQS.map((faq) => (
            <details key={faq.qKey}>
              <summary>{t(faq.qKey, locale)}</summary>
              <div className="answer">{t(faq.aKey, locale)}</div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
