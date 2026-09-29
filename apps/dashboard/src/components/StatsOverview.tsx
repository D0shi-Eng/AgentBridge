"use client";

/** بطاقات الإحصاء الأربع — عرض رقيق فوق stats النقي؛ هياكل تحميل حتى تصل البيانات.
 * التسميات والأزمنة من القاموس وبصيغة اللغة والأرقام ltr محصورة. */

import { t, useLocale } from "@/lib/i18n";
import type { TenantStatsDto } from "@/lib/api-client";
import { SkeletonLine } from "@/components/ui/Skeleton";

export function StatsOverview({ stats, loading }: { stats: TenantStatsDto | null; loading: boolean }) {
  const { locale } = useLocale();
  if (loading || stats === null) {
    return (
      <div className="stat-grid" aria-busy="true">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="stat-card">
            <SkeletonLine width="46%" height={22} />
            <div style={{ height: 6 }} />
            <SkeletonLine width="70%" height={10} />
          </div>
        ))}
      </div>
    );
  }
  const cards = [
    { value: String(stats.totalRuns), label: t("stats.totalRuns", locale), unknown: false },
    { value: String(stats.activeRuns), label: t("stats.activeRuns", locale), unknown: false },
    { value: String(stats.grantedCertificates), label: t("stats.grantedCertificates", locale), unknown: false },
    {
      // لا شهادات ممنوحة بعد = قيمة غير متاحة تُعرض "—" بتفسير وصولي، لا 0 مضلل
      value: stats.avgFinalScore === null ? "—" : `${stats.avgFinalScore}/100`,
      label: t("stats.avgScore", locale),
      unknown: stats.avgFinalScore === null,
    },
  ];
  return (
    <>
      <div className="stat-grid fade-up">
        {cards.map((card) => (
          <div key={card.label} className="stat-card">
            <div className="stat-value" {...(card.unknown ? { "aria-label": t("stats.avgUnknownAria", locale) } : {})}>
              {card.value}
            </div>
            <div className="stat-label">{card.label}</div>
          </div>
        ))}
      </div>
      {stats.lastRunAt !== null && (
        <div style={{ color: "var(--muted)", fontSize: "var(--text--2)", marginBottom: 14 }}>
          {t("stats.lastRun", locale)}{" "}
          <bdi>
            {new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(stats.lastRunAt),
            )}
          </bdi>
        </div>
      )}
    </>
  );
}
