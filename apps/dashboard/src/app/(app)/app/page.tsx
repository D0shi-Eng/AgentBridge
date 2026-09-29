"use client";

/**
 * لوحة المستأجر — نظرة عامة بإحصاءات حية فوق بطاقة الرفع والقوائم.
 * المنطق في lib (stats/api-client) والمكوّن عرض رقيق: هياكل تحميل،
 * حالات فراغ مصممة، وتنبيهات Toast بدل رسائل صامتة.
 * الجلسة من المزود المشترك (نداء واحد لكل تحميل) والخروج في القشرة.
 * الوضع المحلي الفردي: الجلسة تُؤسس تلقائياً بلا شاشة مفتاح وبلا أي
 * رمز في الرابط — فتح /app مباشرة يكفي، وأي فشل يعرض سبباً تشغيلياً.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError, type ProjectDto, type RunListItemDto, type TenantStatsDto } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";
import { apiErrorMessage, t, useLocale } from "@/lib/i18n";
import { LoginCard } from "@/components/LoginCard";
import { LocalConnectCard } from "@/components/LocalConnectCard";
import { SkeletonCard, SkeletonLine } from "@/components/ui/Skeleton";
import { DashboardAuthenticated } from "@/components/DashboardAuthenticated";
import { useToast } from "@/components/ui/ToastProvider";

/** حالة وضع الفتح المحلي من منظور الواجهة — مجهولة قبل أول فحص */
type LocalModeState = "unknown" | "local" | "network" | "multi";

export default function DashboardPage() {
  const router = useRouter();
  const toast = useToast();
  const { locale } = useLocale();
  const { session: creds, ready, error: sessionError, replace, refresh } = useSession();
  const [projects, setProjects] = useState<ProjectDto[]>([]);
  const [runs, setRuns] = useState<RunListItemDto[]>([]);
  const [stats, setStats] = useState<TenantStatsDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newProject, setNewProject] = useState("");
  // مصدر قرار شاشة الفتح هو الخادم حصراً: محلي → تأسيس تلقائي، شبكي →
  // بطاقة مفتاح الاعتيادية، وتعذر الوصول → خطأ تشغيلي لا شاشة تراجع
  const [localMode, setLocalMode] = useState<LocalModeState>("unknown");

  const checkMode = useCallback(async (): Promise<void> => {
    setLocalMode("unknown");
    const mode = await api.localMode();
    setLocalMode(mode === null ? "network" : mode.enabled ? "local" : "multi");
  }, []);

  useEffect(() => {
    if (creds !== null) return;
    void checkMode();
  }, [creds, checkMode]);

  const refreshData = useCallback(
    async (credentials: typeof creds): Promise<boolean> => {
      if (credentials === null) return false;
      try {
        const [projectsResponse, runsResponse, statsResponse] = await Promise.all([
          api.listProjects(credentials),
          api.listPipelines(credentials),
          api.getStats(credentials),
        ]);
        setProjects(projectsResponse.projects);
        setRuns(runsResponse.pipelines.slice(0, 8));
        setStats(statsResponse);
        setError(null);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          replace(null);
        } else if (err instanceof ApiError && err.status === 403) {
          setError(t("error.forbidden", locale));
        } else {
          setError(apiErrorMessage(err, locale, "error.network"));
        }
        return false;
      }
    },
    [locale, replace],
  );

  useEffect(() => {
    if (creds !== null) void refreshData(creds);
  }, [creds, refreshData]);

  // استقصاء خفيف لقائمة التشغيلات والإحصاءات أثناء وجود تشغيل جارٍ
  useEffect(() => {
    if (creds === null || !runs.some((run) => run.status === "running")) return;
    const timer = setInterval(() => void refreshData(creds), 2000);
    return () => clearInterval(timer);
  }, [creds, runs, refreshData]);

  async function addProject(): Promise<void> {
    if (creds === null || newProject.trim().length === 0) return;
    try {
      await api.createProject(creds, newProject.trim());
      toast.success(t("overview.projectCreated", locale, { name: newProject.trim() }));
      setNewProject("");
      await refreshData(creds);
    } catch (err) {
      toast.error(apiErrorMessage(err, locale, "overview.projectCreateFailed"));
    }
  }

  // حالة انتهاء الجلسة على مستوى المزود (401 من /auth/session) — نفس بطاقة الدخول
  useEffect(() => {
    if (sessionError === "forbidden") setError(t("error.forbidden", locale));
    else if (sessionError === "network") setError(t("error.network", locale));
  }, [sessionError, locale]);

  if (!ready) {
    return (
      <div className="wrap">
        <SkeletonLine width="220px" height={26} />
        <div style={{ height: 24 }} />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (creds === null) {
    // الوضع المحلي: تأسيس تلقائي للجلسة — بلا معرف مساحة عمل ولا مفتاح
    if (localMode === "local") {
      return (
        <div className="wrap">
          <LocalConnectCard onLogin={(next) => { replace({ tenantId: next.tenantId }); void refresh(); }} />
          {error !== null && (
            <div style={{ textAlign: "center" }} role="alert">
              <div className="error-box" style={{ display: "inline-block" }}>{error}</div>
            </div>
          )}
        </div>
      );
    }
    // تعذر تحديد الوضع (الخدمة غير قابلة للوصول) — خطأ تشغيلي مفهوم
    // مع إعادة محاولة، لا شاشة مفتاح احتياطية
    if (localMode === "network") {
      return (
        <div className="wrap">
          <div className="card fade-up" style={{ maxWidth: 460, margin: "60px auto", textAlign: "center" }} role="alert">
            {t("login.local.unreachable", locale)}
            <p style={{ marginTop: 14 }}>
              <button type="button" className="btn" onClick={() => void checkMode()}>{t("login.local.retry", locale)}</button>
            </p>
          </div>
        </div>
      );
    }
    // مجهولة قبل أول فحص — هيكل تحميل؛ وشبكي/متعدد المستخدمين → المفتاح
    if (localMode === "unknown") {
      return (
        <div className="wrap">
          <SkeletonCard />
        </div>
      );
    }
    return (
      <div className="wrap">
        <LoginCard
          onLogin={(next) => { replace(next); void refresh(); }}
        />
        {error !== null && (
          <div style={{ textAlign: "center" }} role="alert">
            <div className="error-box" style={{ display: "inline-block" }}>{error}</div>
          </div>
        )}
      </div>
    );
  }

  return (
    <DashboardAuthenticated
      session={creds} projects={projects} runs={runs} stats={stats}
      error={error} newProject={newProject}
      onProjectName={setNewProject}
      onAdd={() => void addProject()}
      onRefresh={() => void refreshData(creds)}
      onStarted={(runId) => router.push(`/runs/${runId}`)}
    />
  );
}
