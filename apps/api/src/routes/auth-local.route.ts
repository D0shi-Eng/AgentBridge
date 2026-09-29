/**
 * جلسة الوضع المحلي — تثبيت فردي على جهاز واحد يفتح اللوحة بلا شاشة مفتاح
 * وبلا أي رمز في الرابط أو سجل المتصفح.
 *
 * العقد الأمني: الاتصال بـlocalhost ليس هوية بحد ذاته (أي صفحة ويب تستطيع
 * إرسال طلبات إلى 127.0.0.1) — لذلك لا تُمنح الجلسة إلا لطلب يستوفي الأربعة:
 *   1) المسار مفعّل بإعداد صريح (LOCAL_BOOTSTRAP=1) وإلا فلا نقطة إطلاقاً.
 *   2) Origin === appOrigin حرفياً — المتصفح يرسل Origin على كل POST.
 *   3) Host ضمن مضيفي الحلقة المسموحين حصراً (حسم DNS rebinding — وهو
 *      محروس شاملاً في app.ts أيضاً، والتكرار هنا دفاع في العمق مقصود).
 *   4) ترويسة مخصصة x-agentbridge-local — صفحة ويب خارجية لا تستطيع وضع
 *      ترويسة مخصصة إلا بنجاح preflight للـCORS (ولا نمنح CORS لأي أصل
 *      إطلاقاً)، ونماذج HTML لا تستطيعها أصلاً؛ فلا صفحة خارجية تصل إلى هنا.
 * جلسة صالحة موجودة في الكوكيز تُعاد هي نفسها دون منح جديدة (لا تضخم جدول
 * الجلسات)، والجلسة الممنوحة مشتقة بآلية الجلسات القياسية القابلة للإبطال
 * بنفس TTL، وصلاحياتها تقاطع اعتماد مساحة العمل المحلية كما في الجسر.
 * نموذج الثقة معلن في docs/security.md: جهاز واحد ومستخدم نظام التشغيل
 * نفسه موثوق — من يستطيع تشغيل برامج على هذا الجهاز أو قراءة ملف تعريف
 * المتصفح فهو داخل الحدود، وهذا التصميم لا يدّعي عزل مستخدمي نفس الجهاز.
 */
import type { FastifyInstance } from "fastify";
import { AppError } from "@agentbridge/shared";
import { hashOpaqueToken, SESSION_ABSOLUTE_MS } from "@agentbridge/infra";
import { internalIdentityId, internalMembershipId, type InternalMembershipRecord } from "@agentbridge/memory";
import type { ApiContainer } from "../container.js";
import { bridgeSessionPermissions, SessionService } from "../auth/session-service.js";
import { cookiePolicy, readCookie, setCsrfCookie, setOpaqueCookie } from "../auth/cookies.js";

/** مضيفو الحلقة المسموحون حصراً في المسار المحلي — أي مضيف آخر (نطاق
 * معاد ربطه إلى 127.0.0.1) يُرفض قبل قراءة أي شيء */
function loopbackHosts(port: number): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

/** الترويسة المخصصة التي يضعها عميل اللوحة حصراً — صفحة ويب خارجية
 * لا تستطيع وضعها دون preflight ناجح ولا نموذج HTML يستطيعها أصلاً */
const LOCAL_CLIENT_HEADER = "x-agentbridge-local";

export function registerLocalAuthRoutes(app: FastifyInstance, container: ApiContainer): void {
  const enabled = container.config.localBootstrapEnabled === true;

  app.get("/auth/local/mode", { config: { auth: "public" } }, async () => ({ enabled }));

  // التعطيل = لا نقطة جلسة إطلاقاً (حتى ليس استثناءً يُستطلع) — واللوحة
  // تعرض بطاقة الدخول الاعتيادية فقط في أوضاع الشبكة/متعدد المستخدمين
  if (!enabled) return;

  const policy = cookiePolicy(container.config.nodeEnv, container.config.stagingHttps);
  const sessions = new SessionService(container.authStore);
  const allowedHosts = loopbackHosts(container.config.port);
  const tenantId = container.config.localTenantId as string;
  const credentialId = container.config.localCredentialId as string;

  app.post("/auth/local/session", { config: { auth: "public" } }, async (request, reply) => {
    if (request.headers.origin !== container.config.appOrigin) throw new AppError("ORIGIN_REJECTED", "أصل المتصفح غير مسموح");
    if (!allowedHosts.has(String(request.headers.host ?? ""))) throw new AppError("HOST_REJECTED", "مضيف الطلب خارج الحلقة المحلية المسموحة");
    if (request.headers[LOCAL_CLIENT_HEADER] !== "1") throw new AppError("FORBIDDEN", "طلب خارج عميل اللوحة المحلي");

    // جلسة صالحة قائمة في الكوكيز تكفي — إعادة الافتتاح لا تنشئ جلسة جديدة
    const rawSession = readCookie(request.headers.cookie, policy.sessionName);
    if (rawSession !== null) {
      const existing = await sessions.authenticate(rawSession);
      if (existing !== null) {
        reply.header("cache-control", "private, no-store");
        return { authenticated: true, tenantId: existing.principal.tenantId };
      }
    }

    const credential = await container.authStore.findApiCredential(credentialId);
    if (credential === null || credential.tenantId !== tenantId || credential.revokedAt !== undefined) {
      throw new AppError("UNAUTHORIZED", "اعتماد مساحة العمل المحلية غير متاح — أعد الإعداد", false, "warning");
    }
    if (credential.expiresAt !== undefined && new Date(credential.expiresAt).getTime() <= Date.now()) {
      throw new AppError("UNAUTHORIZED", "اعتماد مساحة العمل المحلية منتهٍ — أعد الإعداد", false, "warning");
    }

    // العضوية والهوية الداخلية بنمط الجسر حرفياً — صلاحيات الجلسة تقاطع
    // الاعتماد (لا sso:manage ولا tenant:admin من أي مصدر)
    const membership: InternalMembershipRecord = {
      membershipId: internalMembershipId(credential.credentialId),
      identityId: internalIdentityId(credential.credentialId),
      tenantId,
      role: "operator",
      status: "active",
      authorizationVersion: credential.authorizationVersion,
      credentialId: credential.credentialId,
      internalVersion: "1",
      revocable: false,
    };
    await container.authStore.putExternalIdentity({ identityId: membership.identityId, issuer: "urn:agentbridge:internal", subject: membership.credentialId, createdAt: new Date().toISOString() });
    await container.authStore.putMembership(membership);
    const permissions = bridgeSessionPermissions(credential.permissions, membership);
    const issued = await sessions.issue(membership.identityId, membership, hashOpaqueToken(`local-bootstrap:${membership.membershipId}`), "local_bootstrap", permissions);
    const maxAge = Math.floor(SESSION_ABSOLUTE_MS / 1000);
    reply.header("set-cookie", [setOpaqueCookie(policy.sessionName, issued.rawToken, policy.secure, maxAge), setCsrfCookie(issued.csrfToken, policy.secure, maxAge)]);
    reply.header("cache-control", "private, no-store");
    return { authenticated: true, tenantId: membership.tenantId };
  });
}
