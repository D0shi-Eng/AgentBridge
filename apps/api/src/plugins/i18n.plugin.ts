/**
 * إضافة التدويل — تقرأ لغة العميل وتثبتها على الطلب.
 *
 * ماهيتها: تحديد locale من ?lang= (أعلى أولوية) ثم x-tenant-locale ثم Accept-Language ثم افتراضي ar.
 * وظيفتها: توحيد اختيار اللغة لكل المسارات وتمريرها لطبقة الأخطاء بلا تغيير سلوك حالي.
 * كيف: onRequest hook يفحص الترويسات والاستعلام ويزيّن request.locale — لا منطق شبكي.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";

export type RequestLocale = "ar" | "en";

function pickLocale(request: FastifyRequest): RequestLocale {
  const query = request.query as Record<string, unknown> | undefined;
  const langParam = typeof query?.lang === "string" ? query.lang.toLowerCase() : undefined;
  if (langParam === "en" || langParam === "ar") return langParam;
  const tenantLocale = typeof request.headers["x-tenant-locale"] === "string" ? request.headers["x-tenant-locale"].toLowerCase() : undefined;
  if (tenantLocale === "en" || tenantLocale === "ar") return tenantLocale as RequestLocale;
  const accept = typeof request.headers["accept-language"] === "string" ? request.headers["accept-language"].toLowerCase() : "";
  if (accept.includes("en")) return "en";
  if (accept.includes("ar")) return "ar";
  return "ar";
}

export function registerI18n(app: FastifyInstance): void {
  app.decorateRequest("locale", "ar");
  app.addHook("onRequest", async (request) => {
    const locale = pickLocale(request);
    (request as FastifyRequest & { locale: RequestLocale }).locale = locale;
  });
}

export function getLocale(request: FastifyRequest): RequestLocale {
  const locale = (request as FastifyRequest & { locale?: RequestLocale }).locale;
  return locale === "en" ? "en" : "ar";
}
