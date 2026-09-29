"use client";

/**
 * صفحة المراقبة التشغيلية — تعرض مقاييس الطلبات وحالة المكوّنات.
 *
 * ماهيتها: نص Prometheus من المسار الجلسي /ops/metrics + جدول حالة
 * DB/Redis/pgvector من /health/detailed + زر تحديث.
 * وظيفتها: تمكين المستأجر من مراقبة التشغيل بلا تسريب — لا توكن مقاييس
 * في المتصفح ولا مسار عام (إغلاق عيب 401 كان يمنع تحميل الصفحة).
 * كيف: الجزءان مستقلان في الجلب والفشل (فشل المقاييس لا يحجب حالة
 * المكوّنات والعكس)، والفشل يعرض تنبيهاً واحداً يسمّي ما تعذر تحميله
 * تحديداً مع إعادة محاولة — بلا توست مكرر وبلا عبارة عامة.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { opsClient, type HealthDetailed } from "@/lib/ops-client";
import { useSession } from "@/lib/use-session";
import { t, useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { Breadcrumbs } from "@/components/system/AppShell";

/** يترجم حالة المكوّن إلى عربي مفهوم مع إبقاء القيمة الخام في التلميح */
function healthValueLabel(value: string, locale: "ar" | "en"): string {
  if (value === "ok") return t("ops.healthOk", locale);
  if (value === "degraded") return t("ops.healthDegraded", locale);
  return value;
}

export default function OpsPage() {
  const { locale } = useLocale();
  const { session: creds, ready } = useSession();
  const [metricsText, setMetricsText] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthDetailed | null>(null);
  const [loading, setLoading] = useState(false);
  // فشل كل جزء حالة مستقلة — التنبيه يسمّي الأجزاء الفاشلة بالاسم
  const [metricsFailed, setMetricsFailed] = useState(false);
  const [healthFailed, setHealthFailed] = useState(false);
  // حصر المشغّل رفض منظم لا عطل — المستأجر الشبكي يراه حالة معلومة
  const [metricsOperatorOnly, setMetricsOperatorOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setMetricsFailed(false);
    setHealthFailed(false);
    setMetricsOperatorOnly(false);
    try {
      setMetricsText(await opsClient.fetchMetrics());
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      if (code === "METRICS_OPERATOR_ONLY") setMetricsOperatorOnly(true);
      else setMetricsFailed(true);
    }
    if (creds !== null) {
      try {
        setHealth(await opsClient.fetchHealth());
      } catch { setHealthFailed(true); }
    }
    setLoading(false);
  }, [creds]);

  useEffect(() => { void load(); }, [load]);

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

  // تنبيه واحد يجمع الأجزاء التي تعذر تحميلها — لا تكرار ولا عبارة عامة
  const failures: readonly string[] = [
    ...(metricsFailed ? [t("ops.metricsFailed", locale)] : []),
    ...(healthFailed ? [t("ops.healthFailed", locale)] : []),
  ];

  return (
    <div className="wrap">
      <Breadcrumbs items={[
        { label: t("breadcrumb.overview", locale), href: "/app" },
        { label: t("nav.ops", locale) },
      ]} />
      <header className="topbar">
        <h1 style={{ fontSize: "var(--text-2)" }}>{t("ops.title", locale)}</h1>
        <Button variant="ghost" busy={loading} onClick={() => void load()}>{t("ops.refresh", locale)}</Button>
      </header>

      <div className="card">
        {failures.length > 0 && (
          <div role="alert" style={{ marginBottom: 16 }}>
            <div className="error-box">
              {failures.length === 1 ? failures[0] : `${t("ops.partialFailure", locale)}: ${failures.join("، ")}`}
            </div>
            <Button variant="ghost" onClick={() => void load()}>{t("common.retry", locale)}</Button>
          </div>
        )}

        {metricsOperatorOnly && (
          // رفض منظم لا عطل: المستأجر الشبكي لا يرى مقاييس المنصة العامة —
          // حالة معلومة واحدة محددة، وحالة مكوّناته أسفلها تبقى
          <div style={{ opacity: 0.75, fontSize: "var(--text--1)", marginBottom: 8 }}>
            {t("ops.metricsOperatorOnly", locale)}
          </div>
        )}

        {metricsText === null && !metricsFailed && !metricsOperatorOnly ? (<SkeletonCard />) : metricsText !== null ? (
          <>
            <h3 style={{ fontSize: "var(--text-0)", marginBottom: 8 }}>{t("ops.metrics", locale)}</h3>
            {/* المحتوى التقني LTR محصور داخل صفحة RTL — قرار bidi موثق (وثيقة 05) */}
            <pre className="mono" tabIndex={0} style={{ background: "var(--inset)", padding: 12, borderRadius: 8, overflowX: "auto", fontSize: "var(--text--1)", maxHeight: 200, overflowY: "auto" }} dir="ltr" aria-label={t("ops.metrics", locale)}>
              {metricsText.trim().length === 0 ? t("ops.metricsEmpty", locale) : metricsText}
            </pre>
          </>
        ) : null}

        <h3 style={{ fontSize: "var(--text-0)", margin: "16px 0 8px" }}>{t("ops.health", locale)}</h3>
        {health === null && !healthFailed && !loading ? (
          <div style={{ opacity: 0.6, fontSize: "var(--text--1)" }}>{t("ops.healthUnavailable", locale)}</div>
        ) : health === null ? (
          <div style={{ opacity: 0.6, fontSize: "var(--text--1)" }} aria-busy="true">{t("common.loading", locale)}</div>
        ) : (
          <div className="table-scroll">
            <table className="list" aria-label={t("ops.health", locale)}>
              <thead>
                <tr>
                  <th scope="col">{t("ops.healthColumn", locale)}</th>
                  <th scope="col">{t("ops.healthDb", locale)}</th>
                  <th scope="col">{t("ops.healthRedis", locale)}</th>
                  <th scope="col">{t("ops.healthPgvector", locale)}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t("ops.health", locale)}</td>
                  <td className="mono" title={health.db}>{healthValueLabel(health.db, locale)}</td>
                  <td className="mono" title={health.redis}>{healthValueLabel(health.redis, locale)}</td>
                  <td className="mono" title={health.pgvector}>{healthValueLabel(health.pgvector, locale)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
