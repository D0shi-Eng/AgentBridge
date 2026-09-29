"use client";

/**
 * عرض التشغيل الحي؛ إدارة الاتصال والحالة تبقى في صفحة التشغيل.
 * الإجراء الحساس (اعتماد/رفض HITL) يمر بخطوة توكيد داخلية تشرح ما سيحدث
 * قبل التنفيذ، ونقل التركيز إلى زر التأكيد — لا نافذة متصفح خام.
 */

import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "@/lib/i18n";
import type { CertificateDto, ToolDto } from "@/lib/api-client";
import { isTerminal, eventDisplay, type RunViewModel } from "@/lib/run-model";
import { Pill } from "./ui/Pill";
import { Button } from "./ui/Button";
import { Card } from "./ui/Card";
import { Stepper } from "./ui/Stepper";
import { EmptyState } from "./ui/EmptyState";
import { TechId } from "./ui/TechId";
import { RunCertificateCard } from "./RunCertificateCard";
import { Breadcrumbs } from "./system/AppShell";

interface Props {
  runId: string;
  status: string;
  model: RunViewModel | null;
  tools: ToolDto[] | null;
  certificate: CertificateDto | null;
  acting: boolean;
  onAct: (kind: "approve" | "reject") => void;
  onDownload: (path: string, filename: string) => void;
  /** محاولة تنزيل حزمة خادم لشهادة غير ممنوحة — تعرض توست توضيحي من الصفحة */
  onDeniedPackageDownload: () => void;
}

export function RunView(props: Props) {
  const { locale } = useLocale();
  const [pendingAct, setPendingAct] = useState<"approve" | "reject" | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // نقل التركيز إلى زر التأكيد عند ظهور لوحة التوكيد — قرارات لوحة المفاتيح
  useEffect(() => {
    if (pendingAct !== null) confirmRef.current?.focus();
  }, [pendingAct]);

  const toolCount = props.tools?.length ?? 0;
  return (
    <div className="wrap">
      <Breadcrumbs items={[
        { label: t("breadcrumb.overview", locale), href: "/app" },
        { label: `${t("breadcrumb.run", locale)} ${props.runId.slice(0, 8)}…` },
      ]} />
      <header className="topbar">
        <h1 style={{ fontSize: "var(--text-2)" }}>{t("run.title", locale)}</h1>
        <Pill status={props.status} />
      </header>
      <Card title={t("run.progressTitle", locale)}>
        {/* معرف التشغيل بتسمية مفهومة وزر نسخ — المعرف الخام وحده نص غامض */}
        <div style={{ marginBottom: 14, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ color: "var(--muted)", fontSize: "var(--text--1)" }}>{t("run.runIdLabel", locale)}:</span>
          <TechId value={props.runId} label={t("run.runIdLabel", locale)} />
        </div>
        <Stepper model={props.model} runIsOver={isTerminal(props.status)} />
        <div style={{ color: "var(--muted)", fontSize: "var(--text--2)", marginTop: 16 }}>
          {t("stage.progress", locale, { done: props.model?.completedStages ?? 0 })}
        </div>
      </Card>
      {props.status === "suspended" && (
        <Card title={t("run.hitlTitle", locale)} accent={true}>
          {props.tools === null ? <div className="skeleton" /> : <>
            <div className="tools-grid fade-up">{props.tools.map((tool) => (
              <div key={tool.name} className="tool-card">
                <div className="name"><bdi>{tool.name}</bdi></div>
                <div className="desc">{tool.description}</div>
                <div className="eps"><bdi>{tool.endpointIds.join(" · ")}</bdi></div>
              </div>
            ))}</div>
            <p style={{ color: "var(--text-secondary)", fontSize: "var(--text--1)", marginTop: 16 }}>
              {t("run.hitlExplain", locale)}
            </p>
            {pendingAct === null ? (
              <div style={{ display: "flex", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                <Button variant="green" onClick={() => setPendingAct("approve")}>{t("run.hitlApprove", locale)}</Button>
                <Button variant="red" onClick={() => setPendingAct("reject")}>{t("run.hitlReject", locale)}</Button>
              </div>
            ) : (
              <div className="confirm-panel" role="group" aria-label={t(pendingAct === "approve" ? "run.hitlApproveConfirmTitle" : "run.hitlRejectConfirmTitle", locale)}>
                <strong>{t(pendingAct === "approve" ? "run.hitlApproveConfirmTitle" : "run.hitlRejectConfirmTitle", locale)}</strong>
                <p style={{ marginTop: 6 }}>
                  {t(pendingAct === "approve" ? "run.hitlApproveConfirmBody" : "run.hitlRejectConfirmBody", locale, { count: toolCount })}
                </p>
                <div className="actions">
                  <Button
                    variant={pendingAct === "approve" ? "green" : "red"}
                    busy={props.acting}
                    ref={confirmRef}
                    onClick={() => { const kind = pendingAct; setPendingAct(null); if (kind !== null) props.onAct(kind); }}
                  >
                    {t("common.confirm", locale)}
                  </Button>
                  <Button variant="ghost" onClick={() => setPendingAct(null)}>{t("common.cancel", locale)}</Button>
                </div>
              </div>
            )}
          </>}
        </Card>
      )}
      {props.certificate !== null && (
        <RunCertificateCard runId={props.runId} cert={props.certificate} onDownload={props.onDownload}
          onDeniedDownloadAttempt={props.onDeniedPackageDownload} />
      )}
      <Card title={t("run.eventsTitle", locale)}>
        {props.model !== null && props.model.rows.length > 0 ? (
          // نص الحدث يمر عبر eventDisplay (كود مستقر ← ترجمة
          // locale) — الملخص الخام للخادم لا يُعرض أبداً في واجهة EN
          <ol className="timeline">{props.model.rows.map((row, index) => (
            <li key={index}>
              <span className="stage-tag"><bdi>{row.stage}</bdi></span>
              {row.status !== null && <Pill status={row.status} />}
              <span className="summary-ar">{eventDisplay(row, locale)}</span>
            </li>
          ))}</ol>
        ) : <EmptyState icon="📡" title={t("run.eventsEmpty", locale)} hint={t("run.eventsEmptyHint", locale)} />}
      </Card>
    </div>
  );
}
