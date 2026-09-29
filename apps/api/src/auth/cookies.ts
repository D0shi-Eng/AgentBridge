/**
 * حدود cookies — تحليل محدود وبناء خصائص ثابتة لا تعتمد على Host الوارد.
 * وضع HTTP للتطوير يحمل أسماء مختلفة فلا يمكن نقله عرضاً إلى الإنتاج.
 */
export interface CookiePolicy {
  readonly sessionName: string;
  readonly loginName: string;
  readonly secure: boolean;
}

/**
 * سياسة الكوكيز — الإنتاج أو بيئة HTTPS التدريبية (STAGING_HTTPS=1) تحصلان
 * على شكل __Host- + Secure حصراً. المفتاح التدريبي يُشدّد الأمن ولا يخففه:
 * افتراضه غائب يعيد سلوك التطوير التاريخي حرفياً، والاختبارات السلبية تثبت ذلك
 * (اختبارات browser-security-staging). يتيح إثبات أمان الكوكيز حياً على TLS محلي
 * دون رفع الإنتاج كله بمتطلباته (live/مفاتيح/مزود شبكة).
 */
export function cookiePolicy(nodeEnv: string, httpsForced = false): CookiePolicy {
  return nodeEnv === "production" || httpsForced === true
    ? { sessionName: "__Host-ab_session", loginName: "__Host-ab_login", secure: true }
    : { sessionName: "ab_session_dev", loginName: "ab_login_dev", secure: false };
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (header === undefined) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    if (part.slice(0, index).trim() === name) return decodeURIComponent(part.slice(index + 1).trim());
  }
  return null;
}

export function setOpaqueCookie(name: string, value: string, secure: boolean, maxAgeSeconds: number): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}

export function clearOpaqueCookie(name: string, secure: boolean): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? "; Secure" : ""}`;
}

/** CSRF ليس سر هوية؛ JavaScript يحتاجه لإرساله في header مزدوج الربط. */
export function setCsrfCookie(value: string, secure: boolean, maxAgeSeconds: number): string {
  return `ab_csrf=${encodeURIComponent(value)}; Path=/; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure ? "; Secure" : ""}`;
}
