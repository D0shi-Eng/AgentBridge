/**
 * مسارات الجلسة — جسر API-key مؤقت، قراءة الحالة، وlogout فعلي.
 * المفتاح الخام لا يدخل سجل الجلسة ولا يخرج من الخادم بعد التحقق.
 *
 * الجسر لا يوسّع صلاحيات الاعتماد إلى صلاحيات عضوية —
 * العضوية الداخلية غير قابلة للإلغاء اليدوي ومعرفها الاعتماد نفسه،
 * وصلاحيات الجلسة الصادرة = صلاحيات الاعتماد حصراً (تُمرر صراحة)،
 * وإلغاء الاعتماد يلغي عضويته وكل جلساته المشتقة ذرياً في المخزن.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@agentbridge/shared";
import { internalIdentityId, internalMembershipId, type InternalMembershipRecord } from "@agentbridge/memory";
import { hashOpaqueToken, SESSION_ABSOLUTE_MS } from "@agentbridge/infra";
import type { ApiContainer } from "../container.js";
import { authenticateApiKey } from "../auth/api-key-auth.js";
import { bridgeSessionPermissions } from "../auth/session-service.js";
import { clearOpaqueCookie, cookiePolicy, readCookie, setCsrfCookie, setOpaqueCookie } from "../auth/cookies.js";
import { SessionService } from "../auth/session-service.js";
import { requirePrincipal } from "../plugins/auth.plugin.js";

// مستأجرو onboarding يصادقون بمعرف الاعتماد (credentialId) —
// tenantId يبقى إلزامياً للمطابقة، وcredentialId اختياري للمسار الإنتاجي
const BridgeBody = z.object({
  tenantId: z.string().min(1).max(200),
  apiKey: z.string().min(8).max(500),
  credentialId: z.string().min(1).max(200).optional(),
}).strict();

export function registerAuthRoutes(app: FastifyInstance, container: ApiContainer): void {
  const policy = cookiePolicy(container.config.nodeEnv, container.config.stagingHttps);
  const sessions = new SessionService(container.authStore);

  app.post("/auth/api-key/session", { config: { auth: "public" } }, async (request, reply) => {
    // Origin إلزامي حتى لو غابت الترويسة — الجسر سطح متصفح بمعنى التصميم
    if (request.headers.origin !== container.config.appOrigin) throw new AppError("ORIGIN_REJECTED", "أصل المتصفح غير مسموح");
    const parsed = BridgeBody.safeParse(request.body);
    if (!parsed.success) throw new AppError("UNAUTHORIZED", "بيانات المصادقة غير صالحة", false, "warning");
    // المسار الإنتاجي: credentialId.key (فاصلة نقطة)؛ المسار legacy: tenantId.key
    const credentialHeader = parsed.data.credentialId !== undefined
      ? `Bearer ${parsed.data.credentialId}.${parsed.data.apiKey}`
      : `Bearer ${parsed.data.tenantId}:${parsed.data.apiKey}`;
    const service = await authenticateApiKey(container.authStore, credentialHeader);
    if (service === null || service.actorType !== "service" || service.tenantId !== parsed.data.tenantId) throw new AppError("UNAUTHORIZED", "بيانات المصادقة غير صالحة", false, "warning");
    // عضوية داخلية بلا صلاحيات ذاتية: هويتها لا تُلغى يدوياً ووصولها كله عبر
    // الاعتماد — صلاحيات الجلسة تُصدر من الاعتماد لا من الدور.
    const membership: InternalMembershipRecord = {
      membershipId: internalMembershipId(service.credentialId),
      identityId: internalIdentityId(service.credentialId),
      tenantId: service.tenantId, role: "operator", status: "active",
      authorizationVersion: service.authorizationVersion,
      credentialId: service.credentialId, internalVersion: "1", revocable: false,
    };
    // تجسيد الهوية والعضوية الداخليتين (مكرر آمن) — شرط سلامة FK في المخزن الحي
    await container.authStore.putExternalIdentity({ identityId: membership.identityId, issuer: "urn:agentbridge:internal", subject: membership.credentialId, createdAt: new Date().toISOString() });
    await container.authStore.putMembership(membership);
    // صلاحيات الجلسة = تقاطع (اعتماد ∩ allowlist الجسر ∩ دور العضوية)
    // — sso:manage وtenant:admin محجوبان هنا حتى لو حمل الاعتماد نفسه
    const bridgePermissions = bridgeSessionPermissions(service.permissions, membership);
    const issued = await sessions.issue(membership.identityId, membership, hashOpaqueToken(`bridge:${membership.membershipId}`), "api_key_bridge", bridgePermissions);
    const maxAge = Math.floor(SESSION_ABSOLUTE_MS / 1000);
    reply.header("set-cookie", [setOpaqueCookie(policy.sessionName, issued.rawToken, policy.secure, maxAge), setCsrfCookie(issued.csrfToken, policy.secure, maxAge)]);
    reply.header("cache-control", "private, no-store");
    return { authenticated: true, tenantId: membership.tenantId };
  });

  app.get("/auth/session", async (request, reply) => {
    const principal = requirePrincipal(request);
    reply.header("cache-control", "private, no-store");
    return { authenticated: true, actorType: principal.actorType, tenantId: principal.tenantId, permissions: principal.permissions, expiresAt: principal.expiresAt ?? null };
  });

  app.post("/auth/logout", async (request, reply) => {
    requirePrincipal(request);
    const raw = readCookie(request.headers.cookie, policy.sessionName);
    if (raw !== null) await sessions.revoke(raw);
    reply.header("set-cookie", [clearOpaqueCookie(policy.sessionName, policy.secure), "ab_csrf=; Path=/; SameSite=Lax; Max-Age=0"]);
    reply.header("cache-control", "private, no-store");
    return { authenticated: false };
  });
}
