import { cookies } from "next/headers";
import { t } from "@/lib/i18n";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/locale-shared";

/**
 * قسم المصدر المفتوح — يعرض خطط التوفر بصصدق: Community متاح ذاتيًا،
 * وManaged Cloud غير مطلق إنتاجيًا، وEnterprise Support مخطط له.
 * لا أسعار ولا أزرار بيع — لا خدمة متاحة للبيع اليوم.
 * أسماء الخطط الثلاثة أسماء علم إنجليزية فتُحصر في bdi داخل النص العربي.
 */

const TIERS = [
  {
    nameKey: "marketing.tierCommunity",
    badgeKey: "marketing.tierCommunityBadge",
    bodyKey: "marketing.tierCommunityBody",
    featured: false,
    unavailable: false,
  },
  {
    nameKey: "marketing.tierCloud",
    badgeKey: "marketing.tierCloudBadge",
    bodyKey: "marketing.tierCloudBody",
    featured: false,
    unavailable: true,
  },
  {
    nameKey: "marketing.tierEnterprise",
    badgeKey: "marketing.tierEnterpriseBadge",
    bodyKey: "marketing.tierEnterpriseBody",
    featured: false,
    unavailable: false,
  },
] as const;

export async function OpenSourceSection() {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <section className="section" id="open-source">
      <div className="container-wide">
        <div className="section-head">
          <div className="section-kicker">{t("marketing.openKicker", locale)}</div>
          <h2 className="section-title">{t("marketing.openTitle", locale)}</h2>
          <p className="section-sub">{t("marketing.openSub", locale)}</p>
        </div>
        <div className="tier-grid">
          {TIERS.map((tier) => (
            <div
              key={tier.nameKey}
              className={`tier-card${tier.unavailable === true ? " tier-unavailable" : ""}`}
            >
              <div className="tier-head">
                <span className="tier-name"><bdi>{t(tier.nameKey, locale)}</bdi></span>
                <span className="tier-badge">{t(tier.badgeKey, locale)}</span>
              </div>
              <p className="tier-body">{t(tier.bodyKey, locale)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
