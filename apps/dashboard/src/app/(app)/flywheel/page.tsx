"use client";

/**
 * صفحة دروس حلقة التعلّم — جدول دروس بسيط + بحث دلالي + حذف بتوكيد.
 *
 * ماهيتها: تعرض الدروس (specPattern, designDecision, outcome, score, createdAt)
 * مع بحث دلالي وحذف يزيل أيضاً فهرس L3.
 * وظيفتها: تمكين المستأجر من استعراض وحذف دروسه بلا تسريب لمستأجر آخر.
 * كيف: عميل flywheel-client النقي + useLocale/t + حالات تحميل/فراغ/توست حتمية
 * وجدول باسم النمط الرسمي table.list داخل غلاف تمرير. حقل البحث type="search"
 * صراحة كي يشمله تنسيق الحقول الداكنة (القاعدة تستهدف الأنواع المحددة).
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { flywheelClient } from "@/lib/flywheel-client";
import { lessonDecisionView } from "@/lib/flywheel-display";
import { useSession } from "@/lib/use-session";
import { apiErrorMessage, t, useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { TechId } from "@/components/ui/TechId";
import { useToast } from "@/components/ui/ToastProvider";
import { Breadcrumbs } from "@/components/system/AppShell";

function outcomePill(outcome: string): string {
  return outcome === "success" ? "completed" : "failed";
}

export default function FlywheelPage() {
  const toast = useToast();
  const { locale } = useLocale();
  const { session: creds, ready } = useSession();
  const [lessons, setLessons] = useState<import("@/lib/flywheel-client").Lesson[] | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  // فشل التحميل الأولي حالة دائمة بإعادة محاولة لا هيكل أبدي
  const [loadError, setLoadError] = useState(false);

  const load = useCallback(async () => {
    if (creds === null) return;
    setSearching(true);
    setLoadError(false);
    try {
      const result = await flywheelClient.list(creds);
      setLessons(result.lessons);
    } catch (error) { setLoadError(true); toast.error(apiErrorMessage(error, locale, "flywheel.loadFailed")); }
    finally { setSearching(false); }
  }, [creds, locale, toast]);

  useEffect(() => { void load(); }, [load]);

  async function onSearch(): Promise<void> {
    if (creds === null) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) { void load(); return; }
    setSearching(true);
    try {
      const result = await flywheelClient.search(creds, trimmed, 3);
      setLessons(result.lessons);
    } catch (error) { toast.error(apiErrorMessage(error, locale, "flywheel.searchFailed")); }
    finally { setSearching(false); }
  }

  async function onDelete(id: string): Promise<void> {
    if (creds === null) return;
    const confirmed = typeof window !== "undefined" ? window.confirm(t("flywheel.confirmDelete", locale)) : true;
    if (!confirmed) return;
    setBusyId(id);
    try {
      await flywheelClient.remove(creds, id);
      setLessons((prev) => (prev === null ? prev : prev.filter((lesson) => lesson.id !== id)));
      toast.success(t("flywheel.deleted", locale));
    } catch (error) { toast.error(apiErrorMessage(error, locale, "flywheel.deleteFailed")); }
    finally { setBusyId(null); }
  }

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

  const dateFormatter = new Intl.DateTimeFormat(locale === "ar" ? "ar" : "en-GB", { dateStyle: "medium" });

  return (
    <div className="wrap">
      <Breadcrumbs items={[
        { label: t("breadcrumb.overview", locale), href: "/app" },
        { label: t("nav.flywheel", locale) },
      ]} />
      <header className="topbar">
        <h1 style={{ fontSize: "var(--text-2)" }}>{t("flywheel.title", locale)}</h1>
      </header>

      <div className="card">
        <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
          <input
            type="search"
            aria-label={t("flywheel.searchPlaceholder", locale)}
            placeholder={t("flywheel.searchPlaceholder", locale)}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter") void onSearch(); }}
            style={{ flex: 1, minWidth: 200 }}
          />
          <Button variant="primary" busy={searching} onClick={() => void onSearch()}>{t("flywheel.searchButton", locale)}</Button>
          <Button variant="ghost" onClick={() => { setQuery(""); void load(); }}>{t("flywheel.resetButton", locale)}</Button>
        </div>

        {loadError && lessons === null ? (
          <div role="alert">
            <div className="error-box">{t("flywheel.loadFailed", locale)}</div>
            <Button variant="ghost" onClick={() => void load()}>{t("common.retry", locale)}</Button>
          </div>
        ) : lessons === null ? (<SkeletonCard />) : lessons.length === 0 ? (
          <EmptyState icon="📚" title={t("flywheel.emptyTitle", locale)} hint={t("flywheel.emptyHint", locale)} />
        ) : (
          <div className="table-scroll">
            <table className="list" aria-label={t("flywheel.title", locale)}>
              <thead>
                <tr>
                  <th scope="col">{t("flywheel.pattern", locale)}</th>
                  <th scope="col">{t("flywheel.decision", locale)}</th>
                  <th scope="col">{t("flywheel.outcome", locale)}</th>
                  <th scope="col">{t("flywheel.score", locale)}</th>
                  <th scope="col">{t("flywheel.date", locale)}</th>
                  <th scope="col">{t("flywheel.action", locale)}</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((lesson) => {
                  const decision = lessonDecisionView(lesson.designDecision, locale);
                  return (
                  <tr key={lesson.id}>
                    {/* بصمة المواصفة معرّف تقني — مقتطع بزر نسخ لا نص خام طويل */}
                    <td><TechId value={lesson.specPattern} label={t("flywheel.pattern", locale)} /></td>
                    <td style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={decision.raw}>
                      {decision.label}
                    </td>
                    <td><Pill status={outcomePill(lesson.outcome)} /></td>
                    <td className="mono">{String(lesson.score)}</td>
                    <td>{dateFormatter.format(new Date(lesson.createdAt))}</td>
                    <td>
                      <Button variant="red" size="sm" busy={busyId === lesson.id} onClick={() => void onDelete(lesson.id)}>{t("flywheel.delete", locale)}</Button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
