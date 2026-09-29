/**
 * مسار المصادقة الوحيد — يحدد نوع اعتماد واحد ثم يتحقق منه ويصدر Principal.
 * الاعتمادات المتضاربة أو الفاشلة تنهي الطلب؛ لا fallback بين cookie وAPI key.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
/** توسيع Fastify — .ts صريح يستورد مع NodeNext (.js) وvite معاً */
import "./auth-route-types.js";
import { AppError, hasPermission, requireTenantContext, type Permission, type TenantContext } from "@agentbridge/shared";
import type { ApiContainer } from "../container.js";
import { authenticateApiKey } from "../auth/api-key-auth.js";
import { cookiePolicy, readCookie } from "../auth/cookies.js";
import { SessionService } from "../auth/session-service.js";
import { hashOpaqueToken, hashesEqual } from "@agentbridge/infra";

const UNAUTHORIZED = new AppError("UNAUTHORIZED", "بيانات المصادقة غير صالحة أو مفقودة", false, "warning");

export function requirePrincipal(request: FastifyRequest) {
  if (request.principal === undefined) throw new AppError("INTERNAL", "المسار المحمي بلا Principal", false, "critical");
  return request.principal;
}

export function requireContext(request: FastifyRequest): TenantContext {
  const principal = requirePrincipal(request);
  return requireTenantContext({ tenantId: principal.tenantId, principal });
}

/** واجهة توافق ضيقة؛ لا تمثل المستخدم ويجب ألا تستخدم للتفويض. */
export function requireTenant(request: FastifyRequest): string { return requireContext(request).tenantId; }

export function requirePermission(request: FastifyRequest, permission: Permission): TenantContext {
  const context = requireContext(request);
  if (!hasPermission(context.principal, permission)) throw new AppError("FORBIDDEN", "الصلاحية المطلوبة غير متاحة", false, "warning");
  return context;
}

function mutates(method: string): boolean { return method !== "GET" && method !== "HEAD" && method !== "OPTIONS"; }

export function registerAuth(app: FastifyInstance, container: ApiContainer): void {
  app.decorateRequest("principal");
  app.decorateRequest("authSession");
  const policy = cookiePolicy(container.config.nodeEnv, container.config.stagingHttps);
  const sessions = new SessionService(container.authStore);
  app.addHook("onRoute", (options) => {
    options.config = { ...options.config, auth: options.config?.auth ?? "protected" };
  });

  app.addHook("onRequest", async (request) => {
    const mode = request.routeOptions.config.auth;
    if (mode === "public" || mode === undefined) return;
    const direct = request.headers.authorization;
    const alternate = request.headers["x-api-key"];
    if (direct !== undefined && alternate !== undefined) throw UNAUTHORIZED;
    const authorization = direct ?? (typeof alternate === "string" ? `Bearer ${alternate}` : undefined);
    const rawSession = readCookie(request.headers.cookie, policy.sessionName);
    if (authorization !== undefined && rawSession !== null) throw UNAUTHORIZED;
    if (authorization !== undefined) {
      const principal = await authenticateApiKey(container.authStore, authorization, container.semantic);
      if (principal === null) throw UNAUTHORIZED;
      request.principal = principal;
      return;
    }
    if (rawSession === null) throw UNAUTHORIZED;
    const authenticated = await sessions.authenticate(rawSession);
    if (authenticated === null) throw UNAUTHORIZED;
    request.principal = authenticated.principal;
    request.authSession = authenticated.session;
    if (!mutates(request.method)) return;
    const csrf = request.headers["x-csrf-token"];
    const origin = request.headers.origin;
    if (typeof csrf !== "string" || !hashesEqual(hashOpaqueToken(csrf), authenticated.session.csrfHash) || origin !== container.config.appOrigin) {
      throw new AppError("CSRF_REJECTED", "رفض الطلب بسبب حدود المتصفح", false, "warning");
    }
  });
}
