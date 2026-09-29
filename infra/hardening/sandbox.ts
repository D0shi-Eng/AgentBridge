/**
 * إعداد الحاوية المقيدة — حدود security.md §4 البرمجية والدكتارية.
 *
 * ماهيتها: تعريف حتمي لحدود التشغيل الأمني للفحوص الحية (لا root، للقراءة فقط،
 * بلا شبكة إلا localhost، سقف CPU/ذاكرة/PID وseccomp افتراضي) — يستخدمه
 * المنسق والاختبارات للتأكد أن simulate_tool_call لا يتجاوز localhost البتة.
 * وظيفتها: تصدير SANDBOX_CONSTRAINTS وassertLocalhostOnly ودالة isSandboxActive.
 * كيف: دالة نقية تتحقق من URL عبر URL API؛ والحدود مصفوفة ثابتة تُختبر
 * برمجياً في sandbox.spec.ts (whoami≠root وtouch يفشل وcurl خارج localhost يفشل).
 */

export const SANDBOX_CONSTRAINTS = {
  readOnlyRootFilesystem: true,
  user: "65532:65532",
  networkMode: "none" as const,
  allowedHosts: ["127.0.0.1", "localhost", "::1"] as const,
  cpus: 1,
  memory: "512m",
  pidsLimit: 64,
  seccomp: "default" as const,
} as const;

/**
 * يتحقق أن عنوان upstream الممرر يضرب localhost فقط — وإلا يرمي خطأً صريحاً.
 * أي محاولة شبكة خارجية = خرق حاوٍ يُوقف الفحص فوراً.
 */
export function assertLocalhostOnly(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`عنوان غير صالح للتحقق الحاوي: ${rawUrl}`);
  }
  const host = parsed.hostname.toLowerCase();
  const allowed = (SANDBOX_CONSTRAINTS.allowedHosts as unknown as string[]).includes(host);
  if (!allowed) {
    throw new Error(`خرق الحاوية: محاولة وصول خارج localhost → ${rawUrl}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`بروتوكول غير مسموح داخل الحاوية: ${parsed.protocol}`);
  }
}

/** هل العملية الحالية داخل حاوية مقيدة (تحقق برمجي سريع) */
export function isSandboxActive(): boolean {
  // داخل الحاوية المقررة المستخدم 65532 و/ محمّل للقراءة فقط؛ نكشف بتفقد USER وقيود بسيطة
  try {
    const user = process.getuid?.();
    if (user !== undefined && user === 65532) return true;
  } catch {
    // بيئة غير POSIX — نفترض غير محصورة
  }
  return false;
}
