/** عرض اللوحة المصادق عليها؛ المنطق وملكية الجلسة تبقيان في الصفحة.
 * القشرة الموحدة (ترويسة/تنقل/خروج) في AppShell — هنا محتوى النظرة العامة حصراً. */
"use client";

import type { Credentials, ProjectDto, RunListItemDto, TenantStatsDto } from "@/lib/api-client";
import { t, useLocale } from "@/lib/i18n";
import { TechId } from "./ui/TechId";
import { UploadCard } from "./UploadCard";
import { StatsOverview } from "./StatsOverview";
import { RecentRunsCard } from "./RecentRunsCard";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { DataTable } from "./ui/DataTable";

interface Props {
  session: Credentials; projects: ProjectDto[]; runs: RunListItemDto[];
  stats: TenantStatsDto | null; error: string | null; newProject: string;
  onProjectName: (value: string) => void;
  onAdd: () => void; onRefresh: () => void;
  onStarted: (runId: string) => void;
}

export function DashboardAuthenticated(props: Props) {
  const { locale } = useLocale();
  return (
    <div className="wrap">
      <h1 style={{ fontSize: "var(--text-2)", marginBottom: "var(--space-2)" }}>{t("overview.title", locale)}</h1>
      <StatsOverview stats={props.stats} loading={props.stats === null} />
      {props.error !== null && (
        <div className="error-box" role="alert">
          {props.error}{" "}
          <button className="btn ghost sm" onClick={props.onRefresh}>{t("common.retry", locale)}</button>
        </div>
      )}
      <UploadCard creds={props.session} projects={props.projects} onStarted={props.onStarted} />
      <Card title={t("overview.projectsTitle", locale)}>
        <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
          <input
            type="text"
            value={props.newProject}
            onChange={(event) => props.onProjectName(event.target.value)}
            placeholder={t("overview.projectPlaceholder", locale)}
            aria-label={t("overview.projectPlaceholder", locale)}
            onKeyDown={(event) => { if (event.key === "Enter") props.onAdd(); }}
          />
          <Button variant="primary" size="sm" disabled={props.newProject.trim().length === 0} onClick={props.onAdd}>
            {t("overview.addProject", locale)}
          </Button>
        </div>
        {props.projects.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <DataTable
              ariaLabel={t("overview.projectsTitle", locale)}
              columns={[
                { key: "name", header: t("overview.projectColumn", locale) },
                { key: "id", header: t("overview.idColumn", locale) },
              ]}
              rows={props.projects} rowKey={(project) => project.projectId}
              renderCell={(project, key) => key === "name" ? project.name : <TechId value={project.projectId} label={t("overview.idColumn", locale)} />}
            />
          </div>
        )}
      </Card>
      <RecentRunsCard runs={props.runs} hasProjects={props.projects.length > 0} />
    </div>
  );
}
