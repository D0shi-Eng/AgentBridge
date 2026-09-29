"use client";

/**
 * صفحة تحليلات حلقة التعلّم — بطاقات + هيستوغرام + أعلى الأنماط + اتجاه زمني.
 *
 * ماهيتها: تعرض GET /flywheel/analytics لنطاق 7/30/90 يوم معزولاً بالمستأجر.
 * وظيفتها: تمكين المستأجر من فهم توزيع الدروس ومعدل النجاح والأنماط المتكررة.
 * كيف: flywheel-analytics-client النقي + useLocale/t + حالات تحميل/فراغ/توست،
 * والمخططات نصية القيم (لا اعتماد على اللون) ومنطقية الاتجاه، وشبكة بطاقات
 * متجاوبة auto-fit بدل ثلاثة أعمدة ثابتة. ومعدل النجاح يعرض حجم عينته
 * («2 من 2 درس») كي لا توحي نسبة مستمدة من حالتين بنتيجة واسعة.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { flywheelAnalyticsClient, type FlywheelAnalytics, type FlywheelRange } from "@/lib/flywheel-analytics-client";
import { useSession } from "@/lib/use-session";
import { apiErrorMessage, t, useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { TechId } from "@/components/ui/TechId";
import { useToast } from "@/components/ui/ToastProvider";
import { Breadcrumbs } from "@/components/system/AppShell";

export default function AnalyticsPage() {
  const toast = useToast();
  const { locale } = useLocale();
  const { session: creds, ready } = useSession();
  const [range, setRange] = useState<FlywheelRange>("7d");
  const [data, setData] = useState<FlywheelAnalytics | null>(null);
  const [loading, setLoading] = useState(false);
  // فشل التحميل الأولي حالة دائمة بإعادة محاولة لا هيكل أبدي
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async (selected: FlywheelRange) => {
    if (creds === null) return;
    setLoading(true);
    setLoadError(false);
    try {
      const result = await flywheelAnalyticsClient.fetch(creds, selected);
      setData(result);
    } catch (error) { setLoadError(true); toast.error(apiErrorMessage(error, locale, "analytics.loadFailed")); }
    finally { setLoading(false); }
  }, [creds, locale, toast]);

  useEffect(() => { void load(range); }, [load, range]);

  if (!ready) return <div className="wrap"><SkeletonCard /></div>;
  if (creds === null) {
    return (
      <div className="wrap">
        <Card title={t("run.sessionExpiredTitle", locale)}>
          <Link className="btn green" href="/app">{t("error.returnToLogin", locale)}</Link>
        </Card>
      </div>
    );
  }

  const histogramMax = data !== null ? Math.max(1, ...data.histogram) : 1;
  const ranges: ReadonlyArray<{ value: FlywheelRange; key: "analytics.range7d" | "analytics.range30d" | "analytics.range90d" }> = [
    { value: "7d", key: "analytics.range7d" },
    { value: "30d", key: "analytics.range30d" },
    { value: "90d", key: "analytics.range90d" },
  ];

  return (
    <div className="wrap">
      <Breadcrumbs items={[
        { label: t("breadcrumb.overview", locale), href: "/app" },
        { label: t("breadcrumb.analytics", locale) },
      ]} />
      <header className="topbar">
        <h1 style={{ fontSize: "var(--text-2)" }}>{t("analytics.title", locale)}</h1>
      </header>

      <div className="card">
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {ranges.map((item) => (
            <Button
              key={item.value}
              variant={range === item.value ? "primary" : "ghost"}
              onClick={() => setRange(item.value)}
              aria-pressed={range === item.value}
            >
              {t(item.key, locale)}
            </Button>
          ))}
          <Button variant="ghost" onClick={() => void load(range)}>{t("ops.refresh", locale)}</Button>
        </div>

        {loadError && data === null ? (
          <div role="alert">
            <div className="error-box">{t("analytics.loadFailed", locale)}</div>
            <Button variant="ghost" onClick={() => void load(range)}>{t("common.retry", locale)}</Button>
          </div>
        ) : loading || data === null ? (<SkeletonCard />) : data.totalLessons === 0 ? (
          <EmptyState icon="📊" title={t("analytics.emptyTitle", locale)} hint={t("analytics.emptyHint", locale)} />
        ) : (
          <>
            <div className="stat-grid" style={{ marginBottom: 16 }}>
              <div className="stat-card"><div className="stat-value">{String(data.totalLessons)}</div><div className="stat-label">{t("analytics.total", locale)}</div></div>
              <div className="stat-card"><div className="stat-value">{String(data.avgScore)}</div><div className="stat-label">{t("analytics.avgScore", locale)}</div></div>
              <div className="stat-card">
                <div className="stat-value">{`${String(Math.round(data.successRate * 100))}%`}</div>
                <div className="stat-label">{t("analytics.successRate", locale)}</div>
                {/* حجم العينة ظاهر دائماً — نسبة بلا حجمها قد توحي بنتيجة أوسع من واقعها */}
                <div className="stat-label" style={{ opacity: 0.75, fontSize: "var(--text--2)" }}>
                  {t("analytics.successSample", locale, { success: data.successCount, total: data.totalLessons })}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: "var(--text-0)", marginBottom: 8 }}>{t("analytics.histogram", locale)}</h3>
              {/* قيم كل عمود نصية ظاهرة — اللون داعم لا وحيد (WCAG 1.4.1) */}
              <div role="img" aria-label={t("analytics.histogramAria", locale)}
                style={{ display: "flex", alignItems: "end", gap: 8, height: 96 }}>
                {data.histogram.map((count, idx) => (
                  <div key={String(idx)} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4, minWidth: 0 }}>
                    <div style={{
                      width: "100%", height: `${String(Math.max(4, Math.round((count / histogramMax) * 60)))}px`,
                      background: "var(--chart-1)", borderRadius: 4,
                      opacity: count > 0 ? 1 : 0.25,
                    }} />
                    <span className="mono">{String(count)}</span>
                    <span className="mono" style={{ opacity: 0.6 }}>{`${String(idx * 20)}-${String((idx + 1) * 20)}`}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: "var(--text-0)", marginBottom: 8 }}>{t("analytics.topPatterns", locale)}</h3>
              {data.topPatterns.length === 0 ? (
                <EmptyState title={t("analytics.emptyTitle", locale)} />
              ) : (
                <div className="table-scroll">
                  <table className="list" aria-label={t("analytics.topPatterns", locale)}>
                    <thead>
                      <tr>
                        <th scope="col">{t("analytics.pattern", locale)}</th>
                        <th scope="col">{t("analytics.count", locale)}</th>
                        <th scope="col">{t("analytics.avgScore", locale)}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topPatterns.map((row) => (
                        <tr key={row.pattern}>
                          {/* بصمة المواصفة معرّف تقني مقتطع — لا خام طويل غامض */}
                          <td><TechId value={row.pattern} label={t("analytics.pattern", locale)} /></td>
                          <td className="mono">{String(row.count)}</td>
                          <td className="mono">{String(row.avgScore)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div>
              <h3 style={{ fontSize: "var(--text-0)", marginBottom: 8 }}>{t("analytics.trend", locale)}</h3>
              <div role="img" aria-label={t("analytics.trendAria", locale)}
                style={{ display: "flex", gap: 12, overflowX: "auto", paddingBottom: 8 }}>
                {data.trend.map((point) => (
                  <div key={point.date} style={{ minWidth: 56, textAlign: "center" }}>
                    <div className="mono" style={{ fontSize: "var(--text--1)", fontWeight: 600 }}>{String(point.count)}</div>
                    <div className="mono" style={{ fontSize: "var(--text--2)", opacity: 0.6 }}><bdi>{point.date.slice(5)}</bdi></div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
