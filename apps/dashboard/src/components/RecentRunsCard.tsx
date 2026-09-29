"use client";

/** بطاقة آخر التشغيلات — جدول رقيق بحالة فراغ تتغير بحسب وجود مشاريع */
import Link from "next/link";
import { t, useLocale } from "@/lib/i18n";
import type { RunListItemDto } from "@/lib/api-client";
import { Pill } from "@/components/ui/Pill";
import { DataTable } from "@/components/ui/DataTable";
import { EmptyState } from "@/components/ui/EmptyState";
import { TechId } from "@/components/ui/TechId";

export function RecentRunsCard({ runs, hasProjects }: { runs: readonly RunListItemDto[]; hasProjects: boolean }) {
  const { locale } = useLocale();
  return (
    <section className="card">
      <h2>{t("overview.recentRuns", locale)}</h2>
      <DataTable
        ariaLabel={t("overview.recentRuns", locale)}
        columns={[
          { key: "run", header: t("breadcrumb.run", locale) },
          { key: "status", header: t("common.statusLabel", locale) },
          { key: "go", header: "" },
        ]}
        rows={runs}
        rowKey={(run) => run.runId}
        empty={
          hasProjects ? (
            <EmptyState
              icon="⚡"
              title={t("overview.runsEmptyTitle", locale)}
              hint={t("overview.runsEmptyHint", locale)}
            />
          ) : (
            <EmptyState
              icon="🗂"
              title={t("overview.firstProjectTitle", locale)}
              hint={t("overview.firstProjectHint", locale)}
            />
          )
        }
        renderCell={(run, key) => {
          if (key === "run") return <TechId value={run.runId} label={t("run.runIdLabel", locale)} />;
          if (key === "status") return <Pill status={run.status} />;
          return (
            <Link className="link" href={`/runs/${run.runId}`}>
              {t("nav.followRun", locale)}
            </Link>
          );
        }}
      />
    </section>
  );
}
