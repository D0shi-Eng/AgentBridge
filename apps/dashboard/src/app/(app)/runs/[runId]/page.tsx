"use client";

/**
 * صفحة التشغيل — متابعة حية عبر SSE مع تراجع تلقائي إلى NDJSON عند الفشل.
 * Stepper المراحل الثماني + بوابة HITL + بطاقة الشهادة والتنزيلات.
 * فشل SSE الأولي صامت بالتصميم (البث قد يتأخر) لكن فشل fallback يُعلن،
 * والإجراءات الحساسة يديرها RunView بتوكيد داخلي.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, ApiError, type CertificateDto, type ToolDto } from "@/lib/api-client";
import { downloadFile } from "@/lib/api-download";
import { useSession } from "@/lib/use-session";
import { apiErrorMessage, t, useLocale } from "@/lib/i18n";
import { parseNdjson, summarize } from "@/lib/run-model";
import { subscribeSse } from "@/lib/sse-client";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { RunView } from "@/components/RunView";
import { useToast } from "@/components/ui/ToastProvider";
import type { PipelineEvent } from "@agentbridge/shared";

export default function RunPage() {
  const params = useParams<{ runId: string }>();
  const runId = params.runId;
  const toast = useToast();
  const { locale } = useLocale();
  const { session: creds, ready } = useSession();
  const [model, setModel] = useState<ReturnType<typeof summarize> | null>(null);
  const [status, setStatus] = useState<string>("running");
  const [tools, setTools] = useState<ToolDto[] | null>(null);
  const [cert, setCert] = useState<CertificateDto | null>(null);
  const [acting, setActing] = useState(false);
  const eventsRef = useRef<PipelineEvent[]>([]);

  const refreshStatus = useCallback(
    async (credentials = creds) => {
      if (credentials === null) return;
      try {
        const statusResponse = await api.getStatus(credentials, runId);
        setStatus(statusResponse.status);
        if (statusResponse.status === "suspended") {
          const toolsResponse = await api.getTools(credentials, runId);
          setTools(toolsResponse.tools);
        }
        if (statusResponse.status === "completed") setCert(await api.getCertificate(credentials, runId));
      } catch (err) {
        // 404 = التشغيل غير موجود/خارج النطاق — حالة صريحة
        // بدل انتظار بث لن يأتي؛ بقية الأخطاء صامتة (fallback سيأتي بعدها)
        if (err instanceof ApiError && err.status === 404) setStatus("not_found");
      }
    },
    [creds, runId],
  );

  const fallbackPoll = useCallback(
    async (credentials = creds) => {
      if (credentials === null) return;
      try {
        const statusResponse = await api.getStatus(credentials, runId);
        setStatus(statusResponse.status);
        const eventsText = await api.getEventsText(credentials, runId);
        const events = parseNdjson(eventsText) as unknown as PipelineEvent[];
        eventsRef.current = events;
        setModel(summarize(events as unknown as Parameters<typeof summarize>[0]));
        if (statusResponse.status === "suspended") {
          const toolsResponse = await api.getTools(credentials, runId);
          setTools(toolsResponse.tools);
        }
        if (statusResponse.status === "completed") setCert(await api.getCertificate(credentials, runId));
      } catch (err) {
        // 404 هنا أيضاً = حالة غياب صريحة لا فشل شبكة — بلا توست مضلل
        if (err instanceof ApiError && err.status === 404) { setStatus("not_found"); return; }
        toast.error(apiErrorMessage(err, locale, "run.refreshFailed"));
      }
    },
    [creds, runId, toast, locale],
  );

  useEffect(() => {
    if (creds === null) return;
    void refreshStatus(creds);
    let fallbackTimer: ReturnType<typeof setInterval> | undefined;
    let sseFailed = false;
    const unsubscribe = subscribeSse(`/api/pipelines/${runId}/stream`, {}, {
      onEvent: (raw) => {
        const event = raw as PipelineEvent;
        if (typeof event.stage !== "string") return;
        eventsRef.current = [...eventsRef.current, event];
        setModel(summarize(eventsRef.current as unknown as Parameters<typeof summarize>[0]));
      },
      onError: () => {
        if (!sseFailed) {
          sseFailed = true;
          void fallbackPoll(creds);
          fallbackTimer = setInterval(() => void fallbackPoll(), 1200);
        }
      },
      onDone: () => { void refreshStatus(creds); },
    });
    const guard = setTimeout(() => {
      if (eventsRef.current.length === 0 && !sseFailed) void fallbackPoll(creds);
    }, 2500);
    return () => {
      clearTimeout(guard);
      unsubscribe();
      if (fallbackTimer !== undefined) clearInterval(fallbackTimer);
    };
  }, [creds, runId, refreshStatus, fallbackPoll]);

  async function act(kind: "approve" | "reject"): Promise<void> {
    if (creds === null || acting) return;
    setActing(true);
    try {
      if (kind === "approve") { await api.approve(creds, runId); toast.success(t("run.approvedToast", locale)); }
      else { await api.reject(creds, runId); toast.info(t("run.rejectedToast", locale)); }
      await refreshStatus();
      await fallbackPoll();
    } catch (err) { toast.error(apiErrorMessage(err, locale, "run.actFailed")); }
    finally { setActing(false); }
  }

  function safeDownload(path: string, filename: string): void {
    if (creds === null) return;
    void downloadFile(creds, path, filename).catch((err) => toast.error(apiErrorMessage(err, locale, "run.downloadFailed")));
  }

  if (!ready) return <div className="wrap"><SkeletonCard /></div>;
  if (creds === null) {
    return (
      <div className="wrap">
        <Card title={t("run.sessionExpiredTitle", locale)}>
          <Button variant="green" onClick={() => { window.location.href = "/app"; }}>{t("error.returnToLogin", locale)}</Button>
        </Card>
      </div>
    );
  }

  // حالة not-found صريحة: معرف تشغيل غير موجود أو خارج
  // نطاق صلاحية الجلسة يعرض بطاقة غياب بدل شاشة «جارٍ» أبداً
  if (status === "not_found") {
    return (
      <div className="wrap">
        <Card>
          <EmptyState icon="◌" title={t("run.notFoundTitle", locale)} hint={t("run.notFoundHint", locale)} />
          <div style={{ textAlign: "center" }}>
            <Button variant="ghost" onClick={() => { window.location.href = "/app"; }}>
              {t("run.backToDashboard", locale)}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return <RunView runId={runId} status={status} model={model} tools={tools}
    certificate={cert} acting={acting}
    onAct={(kind) => void act(kind)}
    onDownload={safeDownload}
    onDeniedPackageDownload={() => toast.info(t("run.downloadDisabledDenied", locale))} />;
}
