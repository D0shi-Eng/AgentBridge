"use client";

/**
 * بطاقة قرار الشهادة — هرمية واضحة تفصل قرارين مستقلين:
 *   حالة التشغيل: يقرأها المكوّن الأب (شارة أعلى الصفحة).
 *   قرار الشهادة: ممنوحة (أخضر) أو لم تُمنح (عنبري تحذيري — ليست «فشلاً»).
 * السبب يُترجم من الرمز الهيكلي حصراً — نص الخادم الخام لا يُعرض.
 * حماية الادعاء: الحزمة والشارة للممنوح حصراً؛ المرفوض يشرح ولا ينزّل.
 */

import Link from "next/link";
import { certDeniedReasonText, t, useLocale } from "@/lib/i18n";
import type { CertificateDto } from "@/lib/api-client";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Button } from "@/components/ui/Button";
import { TechId } from "@/components/ui/TechId";

export function RunCertificateCard(props: {
  runId: string;
  cert: CertificateDto;
  onDownload: (path: string, filename: string) => void;
  onDeniedDownloadAttempt: () => void;
}) {
  const { cert, runId, onDownload, onDeniedDownloadAttempt } = props;
  const { locale } = useLocale();
  const decisionLabel = cert.granted ? t("status.granted", locale) : t("run.certNotGranted", locale);
  return (
    <section className="card fade-up" aria-labelledby="run-cert-title">
      <h2 id="run-cert-title">{t("run.certDecisionTitle", locale)}</h2>
      <div className="cert-panel">
        <ScoreRing score={cert.finalScore} granted={cert.granted} caption={decisionLabel} />
        <div style={{ flex: 1 }}>
          <p style={{ marginBottom: 6 }}>
            <span className={`pill ${cert.granted ? "completed" : "warning"}`}>{decisionLabel}</span>
          </p>
          <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ color: "var(--muted)", fontSize: "var(--text--1)" }}>{t("run.verificationIdLabel", locale)}:</span>
            <TechId value={cert.verificationId} label={t("run.verificationIdLabel", locale)} />
          </div>
          {/* سبب عدم المنح: ترجمة الرمز الهيكلي — لا نص خام من الخادم */}
          {!cert.granted && (
            <p style={{ color: "var(--muted)", fontSize: "var(--text--2)", marginTop: 6, maxWidth: 520 }}>
              {certDeniedReasonText(cert.notGrantedReasonCode, locale)}
            </p>
          )}
          {cert.granted && (
            <div style={{ color: "var(--muted)", fontSize: "var(--text--2)", marginTop: 6 }}>
              {t("run.certVerifyHint", locale)}{" "}
              <Link className="link" href={`/verify/${cert.verificationId}`}>
                <bdi>/verify/{cert.verificationId}</bdi>
              </Link>
            </div>
          )}
          <div className="downloads">
            <Button
              variant="primary"
              size="sm"
              onClick={() => onDownload(`/pipelines/${runId}/certificate`, `certificate-${runId.slice(0, 8)}.json`)}
            >
              {t("run.certJson", locale)}
            </Button>
            {cert.granted && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => onDownload(`/pipelines/${runId}/badge`, `badge-${runId.slice(0, 8)}.svg`)}
              >
                {t("run.certBadge", locale)}
              </Button>
            )}
            {/* الحزمة ممنوحة فقط — الزر يظهر دائماً لكن الرفض يشرح السبب بدل فشل صامت */}
            <Button
              variant="green"
              size="sm"
              onClick={() => {
                if (cert.granted) onDownload(`/pipelines/${runId}/package`, `generated-server-${runId.slice(0, 8)}.zip`);
                else onDeniedDownloadAttempt();
              }}
            >
              {t("run.certPackage", locale)}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
