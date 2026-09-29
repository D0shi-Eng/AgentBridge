import { cookies } from "next/headers";
import Link from "next/link";
import { t } from "@/lib/i18n";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/locale-shared";
import { PipelineSnapshot } from "@/components/marketing/PipelineSnapshot";
import { OpenSourceSection } from "@/components/marketing/OpenSourceSection";
import { FaqSection } from "@/components/marketing/FaqSection";

/**
 * الصفحة الهبوطية — الهوية العامة لمشروع مفتوح المصدر:
 * قيمة ← لماذا ← آلية العمل بأربع خطوات ← أدلة لا ادعاءات ← المصدر المفتوح ← أسئلة.
 * التصور المعتمد: AgentBridge يحوّل مواصفات OpenAPI إلى خوادم MCP قابلة
 * للمراجعة ويولّد معها أدلة فحص مرتبطة ببصمة المخرجات — لا ادعاء أمان مطلق
 * ولا جاهزية إنتاجية ولا أسعار (اللقطة موسومة «توضيحي» دائماً).
 * كل النصوص من القاموس عبر كوكي اللغة — لا سلسلة صلبة.
 */

const HOW_STEPS = [
  { titleKey: "marketing.how1Title", bodyKey: "marketing.how1Body", chipKey: "marketing.how1Chip" },
  { titleKey: "marketing.how2Title", bodyKey: "marketing.how2Body", chipKey: "marketing.how2Chip" },
  { titleKey: "marketing.how3Title", bodyKey: "marketing.how3Body", chipKey: "marketing.how3Chip" },
  { titleKey: "marketing.how4Title", bodyKey: "marketing.how4Body", chipKey: "marketing.how4Chip" },
] as const;

const SECURITY_CARDS = [
  { titleKey: "marketing.securityChecksTitle", bodyKey: "marketing.securityChecksBody" },
  { titleKey: "marketing.securityChainTitle", bodyKey: "marketing.securityChainBody" },
  { titleKey: "marketing.securityHitlTitle", bodyKey: "marketing.securityHitlBody" },
  { titleKey: "marketing.securityPublicTitle", bodyKey: "marketing.securityPublicBody" },
] as const;

export default async function LandingPage() {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <main>
      {/* ===== البطل ===== */}
      <section className="hero container-wide">
        <span className="eyebrow">{t("marketing.eyebrow", locale)}</span>
        <h1 className="hero-title">
          {t("marketing.heroTitleA", locale)}
          <span className="accent">{t("marketing.heroTitleAccent", locale)}</span>
          {t("marketing.heroTitleB", locale)}
        </h1>
        <p className="hero-sub">{t("marketing.heroSub", locale)}</p>
        <div className="hero-actions">
          <Link href="/app" className="btn green lg">
            {t("marketing.ctaStart", locale)}
          </Link>
          <a href="#how" className="btn ghost lg">
            {t("marketing.ctaHow", locale)}
          </a>
        </div>
        <PipelineSnapshot locale={locale} />
      </section>

      {/* ===== لماذا AgentBridge ===== */}
      <section className="section section-alt">
        <div className="container-wide">
          <div className="section-head">
            <h2 className="section-title">{t("marketing.whyTitle", locale)}</h2>
            <p className="section-sub">{t("marketing.whyLead", locale)}</p>
          </div>
          <p className="section-body">{t("marketing.whyBody", locale)}</p>
          <div className="grid-2">
            <div className="feature-card">
              <h3>{t("marketing.whyInputTitle", locale)}</h3>
              <p>{t("marketing.whyInputBody", locale)}</p>
            </div>
            <div className="feature-card">
              <h3>{t("marketing.whyOutputsTitle", locale)}</h3>
              <p>{t("marketing.whyOutputsBody", locale)}</p>
            </div>
          </div>
        </div>
      </section>

      {/* ===== آلية العمل ===== */}
      <section className="section" id="how">
        <div className="container-wide">
          <div className="section-head">
            <div className="section-kicker">{t("marketing.howKicker", locale)}</div>
            <h2 className="section-title">{t("marketing.howTitle", locale)}</h2>
            <p className="section-sub">{t("marketing.howSub", locale)}</p>
          </div>
          {/* شبكة رباعية صريحة — 4 أعمدة واسعاً / 2×2 متوسطاً /
              عمود واحد على الهاتف؛ يستحيل شكل 3+1 الذي ينتجه auto-fit */}
          <div className="grid-4">
            {HOW_STEPS.map((step, index) => (
              <div key={step.titleKey} className="feature-card fade-up">
                <div className="num" aria-hidden="true">{index + 1}</div>
                <h3>{t(step.titleKey, locale)}</h3>
                <p>{t(step.bodyKey, locale)}</p>
                <div className="stage-tag how-chip"><bdi>{t(step.chipKey, locale)}</bdi></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== الأمان — أدلة لا ادعاءات ===== */}
      <section className="section section-alt" id="security">
        <div className="container-wide">
          <div className="section-head">
            <div className="section-kicker">{t("marketing.securityKicker", locale)}</div>
            <h2 className="section-title">{t("marketing.securityTitle", locale)}</h2>
            <p className="section-sub">{t("marketing.securitySub", locale)}</p>
          </div>
          {/* ملزم: بطاقات الأمان الأربع 2×2 على سطح المكتب
              وعمود واحد على الهاتف (يستحيل 3+1) */}
          <div className="grid-2x2">
            {SECURITY_CARDS.map((card) => (
              <div key={card.titleKey} className="feature-card">
                <h3>{t(card.titleKey, locale)}</h3>
                <p>{t(card.bodyKey, locale)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== المصدر المفتوح والأسئلة ===== */}
      <OpenSourceSection />
      <FaqSection />
    </main>
  );
}
