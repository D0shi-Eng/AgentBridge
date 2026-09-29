import { NextResponse, type NextRequest } from "next/server";

/**
 * سياسة أمن المحتوى بـnonce لكل مستند — إغلاق ثغرة `unsafe-inline` في script-src.
 *
 * كيف: nonce عشوائي لكل طلب يوضع في ترويسة CSP على الطلب (Next يقرأه ويلصقه
 * تلقائياً على سكربتات الترطيب الخاصة به) وعلى الاستجابة للمتصفح، مع
 * strict-dynamic حتى لا تنفتح الباب لأي سكربت خارجي مستقبلاً.
 * التنفيذ في بيئة التطوير يضيف unsafe-eval لتعمل أدوات Next الحية حصراً.
 * باقي المسارات الثابتة (_next/static|image) ووكيل /api مستثناة — للأخير
 * سياسة مستقلة يصدرها الخادم نفسه (طبقة الحدود الأمنية في apps/api).
 *
 * هذه الطبقة للوثائق (HTML) فقط؛ الترويسات الأخرى
 * (nosniff/referrer/frame) تبقى في next.config لكل المسارات.
 */

/** يبني نص السياسة — نقية لتُختبر ولا تعتمد على الطلب */
export function buildCsp(nonce: string, isDev: boolean): string {
  const devOnly = isDev ? " 'unsafe-eval'" : "";
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${devOnly}`,
    "style-src 'self' 'unsafe-inline'", // Next يحقن أنماط ترطيب داخلية — توثيق القيد في تقرير 08
    "img-src 'self' data:",
    "connect-src 'self'",
    "font-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");
}

/** حارس مضيف اللوحة في المسار المحلي - حسم إعادة ربط DNS: المتغيران
 * يضبطهما سكربت التشغيل فقط عند التثبيت المحلي (LOCAL_ENFORCE_HOST=1)
 * وأي مضيف آخر مثل نطاق معاد ربطه إلى 127.0.0.1 يُرفض قبل التصيير */
function hostAllowed(request: NextRequest): boolean {
  if (process.env.LOCAL_ENFORCE_HOST !== "1") return true;
  const port = process.env.DASHBOARD_PORT ?? "3000";
  const allowed = new Set(["127.0.0.1:" + port, "localhost:" + port, "[::1]:" + port]);
  const host = (request.headers.get("host") ?? "").toLowerCase();
  return allowed.has(host);
}

export function middleware(request: NextRequest): NextResponse {
  if (!hostAllowed(request)) {
    return new NextResponse("forbidden: host not allowed", { status: 403 });
  }

  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV !== "production";
  const csp = buildCsp(nonce, isDev);

  const requestHeaders = new Headers(request.headers);
  // Next.js يقرأ الـnonce من ترويسة CSP على الطلب ويلصقه على سكربتاته تلقائياً
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // كل الوثائق ما عدا وكيل الـAPI وأصول Next الثابتة
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
