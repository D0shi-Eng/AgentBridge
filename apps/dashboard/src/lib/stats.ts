/**
 * إحصاءات المستأجر النقية — تُغذي بطاقات النظرة العامة فوق قوائم اللوحة.
 * مدخلاتها صفوف L2 كما تعود من الـAPI حصراً؛ لا حساب في المكوّنات.
 */

export interface PipelineLite {
  readonly status: string;
  readonly createdAt: string;
}

export interface CertificateLite {
  readonly granted: boolean;
  readonly finalScore: number;
}

export interface TenantStats {
  /** إجمالي التشغيلات */
  readonly totalRuns: number;
  /** التشغيلات غير المنتهية (جارية أو معلقة) */
  readonly activeRuns: number;
  /** الشهادات الممنوحة فقط — المرفوضة لا تحسب */
  readonly grantedCertificates: number;
  /** متوسط درجات الشهادات الممنوحة — null إن لا شهادات */
  readonly avgFinalScore: number | null;
  /** زمن آخر تشغيل — null إن لا تشغيلات */
  readonly lastRunAt: string | null;
}

const ACTIVE_STATUSES = new Set(["running", "suspended"]);

/** يشتق بطاقات الإحصاء الأربع: تشغيلات/شهادات/متوسط الدرجة/آخر تشغيل */
export function computeTenantStats(
  pipelines: readonly PipelineLite[],
  certificates: readonly CertificateLite[],
): TenantStats {
  const granted = certificates.filter((certificate) => certificate.granted);
  const avg =
    granted.length > 0
      ? Math.round(granted.reduce((sum, certificate) => sum + certificate.finalScore, 0) / granted.length)
      : null;
  const lastRunAt = pipelines.reduce<string | null>(
    (latest, pipeline) => (latest === null || pipeline.createdAt > latest ? pipeline.createdAt : latest),
    null,
  );
  return {
    totalRuns: pipelines.length,
    activeRuns: pipelines.filter((pipeline) => ACTIVE_STATUSES.has(pipeline.status)).length,
    grantedCertificates: granted.length,
    avgFinalScore: avg,
    lastRunAt,
  };
}
