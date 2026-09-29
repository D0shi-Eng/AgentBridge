/**
 * معالج الأخطاء الموحد — كل خطأ يخرج للعميل بشكل واحد آمن:
 *   AppError برمز معروف → الحالة المناسبة ورسالة مترجمة حسب locale.
 *   AppError داخلي/غير معروف أو استثناء غريب → 500 عام بلا أي تفصيل.
 *
 * لا مسارات مكدس ولا رسائل مكتبات — تسريب التفاصيل ثغرة (وثيقة 06).
 * يدعم التدويل عبر request.locale القادم من i18n.plugin.
 */

import type { FastifyInstance, FastifyRequest } from "fastify";
import { AppError, t, type I18nKey, type Locale } from "@agentbridge/shared";

export interface ErrorEnvelope {
  readonly error: { readonly code: string; readonly message: string };
}

export function errorBody(code: string, message: string): ErrorEnvelope {
  return { error: { code, message } };
}

/** خريطة رموز الأخطاء المعروفة ← حالة HTTP */
const STATUS_BY_CODE: Readonly<Record<string, number>> = {
  INVALID_INPUT: 400,
  SPEC_PARSE_FAILED: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  CSRF_REJECTED: 403,
  ORIGIN_REJECTED: 403,
  HOST_REJECTED: 403,
  // رموز التأسيس المحلي: استهلاك الرمز 409 منظم، وغياب بصمته 503 قابل للمعالجة بتشغيل agentbridge open
  LOCAL_BOOTSTRAP_CONSUMED: 409,
  LOCAL_BOOTSTRAP_UNAVAILABLE: 503,
  SSO_UNAVAILABLE: 404,
  SSO_UPSTREAM_FAILED: 502,
  SSO_CONFIG_CONFLICT: 409,
  NOT_FOUND: 404,
  SPEC_TOO_LARGE: 413,
  NO_SNAPSHOT: 409,
  RUN_ALREADY_ACTIVE: 409,
  // بوابات تذاكر الموافقة البشرية — كلها رفض 409 منظّم
  APPROVAL_REQUIRED: 409,
  APPROVAL_MALFORMED: 409,
  APPROVAL_BAD_SIGNATURE: 409,
  APPROVAL_UNKNOWN_KEY: 409,
  APPROVAL_MISMATCH: 409,
  APPROVAL_STALE: 409,
  APPROVAL_IDENTITY: 409,
  APPROVAL_AUTHORIZATION_STALE: 409,
  APPROVAL_EXPIRED: 409,
  APPROVAL_REUSED: 409,
  LLM_BUDGET_EXCEEDED: 429,
  HARD_LIVE_PROBES_FAILED: 500,
  // رفض حزمة غير معتمدة وحدود الخدمة
  ARTIFACT_NOT_CERTIFIED: 403,
  // مقاييس المنصة العامة للمشغّل حصراً — مستأجر شبكي يُرفض 403 منظّماً
  METRICS_OPERATOR_ONLY: 403,
  // الشهادة الملغاة لا تسلّم مخرجاتها، والإبطال نهائي 409
  ARTIFACT_REVOKED: 403,
  CERT_ALREADY_REVOKED: 409,
  TOO_MANY_ACTIVE_RUNS: 429,
  RATE_LIMITED: 429,
  // رموز مسار SSO كانت تسقط في 500 العام رغم كونها مرفوضات منظمة
  SSO_JWKS_FAILED: 502,
  SSO_TOKEN_INVALID: 401,
  SSO_ISSUER_MISMATCH: 401,
};

const CODE_TO_KEY: Readonly<Record<string, I18nKey>> = {
  SPEC_PARSE_FAILED: "error.SPEC_PARSE_FAILED",
  INVALID_INPUT: "error.INVALID_INPUT",
  LLM_OUTPUT_INVALID: "error.LLM_OUTPUT_INVALID",
  SECURITY_CRITICAL: "error.SECURITY_CRITICAL",
  INTERNAL: "error.INTERNAL",
  UNAUTHORIZED: "error.UNAUTHORIZED",
  NOT_FOUND: "error.NOT_FOUND",
  SPEC_TOO_LARGE: "error.SPEC_TOO_LARGE",
  NO_SNAPSHOT: "error.NO_SNAPSHOT",
  RUN_ALREADY_ACTIVE: "error.RUN_ALREADY_ACTIVE",
  LLM_BUDGET_EXCEEDED: "error.LLM_BUDGET_EXCEEDED",
  METRICS_OPERATOR_ONLY: "error.METRICS_OPERATOR_ONLY",
  HARD_LIVE_PROBES_FAILED: "error.HARD_LIVE_PROBES_FAILED",
};

function localeOf(request: FastifyRequest): Locale {
  const locale = (request as FastifyRequest & { locale?: Locale }).locale;
  return locale === "en" ? "en" : "ar";
}

function translatedMessage(code: string, locale: Locale, fallback: string): string {
  const key = CODE_TO_KEY[code];
  if (key === undefined) return fallback;
  // للأخطاء التي تحمل تفصيلاً نمررها كمتغير إن وُجد {{detail}} أو {{field}}
  // نحاول استخلاص المتغير من الرسالة الأصلية بعد ":" — حتمي وبسيط
  const detail = fallback.includes(":") ? fallback.split(":").slice(1).join(":").trim() : fallback;
  if (key === "error.SPEC_PARSE_FAILED") return t(key, locale, { detail });
  if (key === "error.INVALID_INPUT") return t(key, locale, { field: detail.length > 0 ? detail : fallback });
  return t(key, locale);
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const locale = localeOf(request as FastifyRequest);
    const generic500 = t("error.INTERNAL", locale);
    if (error instanceof AppError) {
      const status = STATUS_BY_CODE[error.code] ?? 500;
      const message = status === 500 ? generic500 : translatedMessage(error.code, locale, error.message);
      request.log[status >= 500 ? "error" : "warn"]({ code: error.code }, message);
      return reply.code(status).send(errorBody(error.code, message));
    }

    // أخطاء Fastify البنيوية (JSON تالف، جسم كبير، مسار غير موجود)
    const shaped = error as { statusCode?: number };
    const statusCode = typeof shaped.statusCode === "number" ? shaped.statusCode : 500;
    if (statusCode < 500) {
      let key: I18nKey = "error.INVALID_BODY";
      let code = "INVALID_INPUT";
      if (statusCode === 404) { key = "error.ROUTE_NOT_FOUND"; code = "NOT_FOUND"; }
      else if (statusCode === 413) { key = "error.REQUEST_TOO_LARGE"; code = "INVALID_INPUT"; }
      const message = t(key, locale);
      return reply.code(statusCode).send(errorBody(code, message));
    }

    request.log.error({ err: error }, generic500);
    return reply.code(500).send(errorBody("INTERNAL", generic500));
  });
}
