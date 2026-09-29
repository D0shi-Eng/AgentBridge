/**
 * عميل الـAPI — غلاف واحد فوق fetch عبر وكيل /api الداخلي.
 * كل فشل يخرج ApiError برسالة عربية من مغلف الخادم الموحد،
 * والتنزيلات تمر blob لأن الترويسة لا تصل عبر روابط <a> العادية.
 */

export interface Credentials {
  readonly tenantId: string;
  readonly permissions?: readonly string[];
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function csrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("ab_csrf="));
  return entry === undefined ? undefined : decodeURIComponent(entry.slice("ab_csrf=".length));
}

function headers(json: boolean, method: string): HeadersInit {
  const base: Record<string, string> = {};
  if (json) base["content-type"] = "application/json";
  if (method !== "GET" && method !== "HEAD") {
    const csrf = csrfToken();
    if (csrf !== undefined) base["x-csrf-token"] = csrf;
  }
  return base;
}

export { headers };
export { csrfToken };
import type { CertificateDto, ProjectDto, RunListItemDto, StatusDto, TenantStatsDto, ToolDto } from "./api-dto";
export type { CertificateDto, ProjectDto, RunListItemDto, StatusDto, TenantStatsDto, ToolDto };

async function request<T>(_session: Credentials, method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { ...headers(body !== undefined, method), ...(extraHeaders ?? {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    credentials: "include",
    cache: "no-store",
  });
  const text = await response.text();
  if (!response.ok) {
    let code = `HTTP_${response.status}`;
    let message = ""; // الرسالة من مغلف الخادم إن وجد — وإلا تُترجم محلياً في الواجهة
    try {
      const envelope = JSON.parse(text) as { error?: { code?: string; message?: string } };
      if (envelope.error?.code !== undefined) code = envelope.error.code;
      if (envelope.error?.message !== undefined) message = envelope.error.message;
    } catch {
      // جسم غير JSON — نُبقي الرسالة العامة
    }
    throw new ApiError(response.status, code, message);
  }
  return (text.length === 0 ? ({} as T) : (JSON.parse(text) as T)) as T;
}

export const api = {
  /** /health عام بلا مصادقة */
  health: async (): Promise<{ status: string; service: string }> => {
    const response = await fetch("/api/health", { cache: "no-store" });
    return (await response.json()) as { status: string; service: string };
  },
  /**
   * مستأجرو onboarding يصادقون بمعرف اعتمادهم (الاصطلاح
   * bootstrap-<tenantId>) — نجرّب الصيغة الإنتاجية أولاً ثم نتراجع
   * إلى صيغة legacy القديمة حتى لا ينكسر أي مستأجر تاريخي.
   */
  login: async (tenantId: string, apiKey: string): Promise<{ authenticated: true; tenantId: string }> => {
    try {
      return await request<{ authenticated: true; tenantId: string }>({ tenantId }, "POST", "/auth/api-key/session", { tenantId, apiKey, credentialId: `bootstrap-${tenantId}` });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return await request<{ authenticated: true; tenantId: string }>({ tenantId }, "POST", "/auth/api-key/session", { tenantId, apiKey });
      }
      throw error;
    }
  },
  /**
   * فحص جلسة الوضع المحلي - عام بلا مصادقة ويعرف التفعيل/التعطيل فقط.
   * null = تعذر تحديد الحالة (الخدمة غير قابلة للوصول) — تُعرض حالة خطأ
   * تشغيلي ولا تُعرض شاشة مفتاح التراجع إطلاقاً في التثبيت المحلي.
   */
  localMode: async (): Promise<{ enabled: boolean } | null> => {
    try {
      const response = await fetch("/api/auth/local/mode", { cache: "no-store" });
      if (!response.ok) return null;
      return (await response.json()) as { enabled: boolean };
    } catch {
      return null;
    }
  },
  /**
   * تأسيس الجلسة المحلية تلقائياً - بلا رمز وبلا رابط خاص؛ الكوكيز
   * يضعها الخادم. الترويسة المخصصة حاجز صفحات الويب الخارجية: لا تستطيع
   * وضعها إلا بـpreflight ناجح (لا CORS لأي أصل) والنماذج لا تستطيعها أصلاً.
   */
  localSession: () =>
    request<{ authenticated: true; tenantId: string }>({ tenantId: "local" }, "POST", "/auth/local/session", undefined, { "x-agentbridge-local": "1" }),
  session: () => request<{ authenticated: true; tenantId: string; permissions: string[] }>({ tenantId: "session" }, "GET", "/auth/session"),
  logout: (c: Credentials) => request<{ authenticated: false }>(c, "POST", "/auth/logout", {}),
  listProjects: (c: Credentials) => request<{ projects: ProjectDto[] }>(c, "GET", "/projects"),
  createProject: (c: Credentials, name: string) =>
    request<ProjectDto>(c, "POST", "/projects", { name }),
  uploadSpec: (c: Credentials, projectId: string, content: string) =>
    request<{ specId: string; bytes: number }>(c, "POST", "/specs", { projectId, content }),
  startPipeline: (c: Credentials, projectId: string, specId: string, requireApproval: boolean) =>
    request<{ runId: string; status: string }>(c, "POST", "/pipelines", {
      projectId,
      specId,
      requireApproval,
    }),
  listPipelines: (c: Credentials) => request<{ pipelines: RunListItemDto[] }>(c, "GET", "/pipelines"),
  getStatus: (c: Credentials, runId: string) => request<StatusDto>(c, "GET", `/pipelines/${runId}/status`),
  getEventsText: async (_session: Credentials, runId: string): Promise<string> => {
    const response = await fetch(`/api/pipelines/${runId}/events`, {
      headers: headers(false, "GET"),
      credentials: "include",
      cache: "no-store",
    });
    if (!response.ok) throw new ApiError(response.status, `HTTP_${response.status}`, "");
    return response.text();
  },
  getTools: (c: Credentials, runId: string) => request<{ tools: ToolDto[] }>(c, "GET", `/pipelines/${runId}/tools`),
  approve: (c: Credentials, runId: string) => request<{ runId: string }>(c, "POST", `/pipelines/${runId}/resume`, {}),
  reject: (c: Credentials, runId: string) => request<{ runId: string }>(c, "POST", `/pipelines/${runId}/reject`, {}),
  getCertificate: (c: Credentials, runId: string) =>
    request<CertificateDto>(c, "GET", `/pipelines/${runId}/certificate`),
  /** إحصاءات المستأجر للنظرة العامة — نطاقه من الترويسة حصراً */
  getStats: (c: Credentials) => request<TenantStatsDto>(c, "GET", "/stats"),
};

/**
 * قراءة تحقق عام بلا أي مصادقة — نفس ما يراه زائر خارجي يحمل رابط شارة.
 * يعيد الشكل الخام والنموذج النقي في verify-model هو من يثبت صحته.
 */
export async function fetchPublicVerification(verificationId: string): Promise<unknown> {
  const response = await fetch(`/api/verify/${encodeURIComponent(verificationId)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new ApiError(response.status, `HTTP_${response.status}`, "");
  }
  return (await response.json()) as unknown;
}
