/**
 * رحلة OIDC الكاملة — state/nonce/PKCE ومعاملة خادمية one-time وربط عضوية.
 * لا token يعود إلى JavaScript؛ النجاح يدور إلى session cookie opaque.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError } from "@agentbridge/shared";
import { LOGIN_TRANSACTION_MS, SESSION_ABSOLUTE_MS, hashOpaqueToken, hashesEqual, openSecret, pkceChallenge, randomOpaqueToken, sealSecret, verifyOidcToken } from "@agentbridge/infra";
import type { ApiContainer } from "../container.js";
import { cookiePolicy, readCookie, setCsrfCookie, setOpaqueCookie } from "../auth/cookies.js";
import { SessionService } from "../auth/session-service.js";

const StartBody = z.object({ tenantId: z.string().min(1).max(200), returnPath: z.string().max(300).default("/app") }).strict();
/**
 * IdP حقيقي: المواصفة OIDC توجب تجاهل البارامترات غير المعروفة
 * في redirect — Keycloak الفعلي يضيف iss/session_state وهو ما رفضته
 * .strict() فكسرت الرحلة الحقيقية (لم تكسرها المحاكاة لأنها لم تكن
 * ترسلها). نستخلص code/state حصراً وندع الزوائد تُسقط — لا ثقة بها ولا
 * رفض لها؛ الحقن يبقى محكوماً بحدود الطول وبأحادية استهلاك المعاملة.
 */
const CallbackQuery = z.object({ code: z.string().min(1).max(2048), state: z.string().min(1).max(500) }).strip();
function localPath(value: string): boolean { return /^\/[A-Za-z0-9/_?=&.-]*$/u.test(value) && !value.startsWith("//") && !value.includes("\r") && !value.includes("\n"); }

export function registerOidcRoutes(app: FastifyInstance, container: ApiContainer): void {
  const policy = cookiePolicy(container.config.nodeEnv, container.config.stagingHttps);
  const sessions = new SessionService(container.authStore);

  app.post("/auth/oidc/start", { config: { auth: "public" } }, async (request, reply) => {
    if (request.headers.origin !== container.config.appOrigin) throw new AppError("ORIGIN_REJECTED", "أصل المتصفح غير مسموح");
    const parsed = StartBody.safeParse(request.body);
    if (!parsed.success || !localPath(parsed.data.returnPath)) throw new AppError("INVALID_INPUT", "طلب بدء الدخول غير صالح");
    const config = await container.ssoStore.getPrivate(parsed.data.tenantId);
    if (config === null || !config.enabled || config.authorizationEndpoint === undefined || config.tokenEndpoint === undefined) throw new AppError("SSO_UNAVAILABLE", "الدخول الموحد غير متاح", false, "warning");
    const state = randomOpaqueToken(); const nonce = randomOpaqueToken(); const verifier = randomOpaqueToken(48);
    const transactionId = randomUUID();
    const binding = readCookie(request.headers.cookie, policy.loginName) ?? randomOpaqueToken();
    await container.authStore.putLoginTransaction({
      transactionId, stateHash: hashOpaqueToken(state), browserBindingHash: hashOpaqueToken(binding),
      tenantId: parsed.data.tenantId,
      // الهوية والإصدار مطلوبان في العقد الداخلي — لا fallback صامت
      // (`?? ""` كان يفتح ثغرة معاملات بلا هوية دورة)
      configVersion: config.configVersion, configInstanceId: config.configInstanceId,
      nonce,
      verifierEnvelope: sealSecret(container.keyProvider, verifier, { tenantId: parsed.data.tenantId, resourceId: transactionId, purpose: "pkce_verifier", version: 1 }),
      redirectUri: container.config.oidcRedirectUri, returnPath: parsed.data.returnPath,
      expiresAt: new Date(Date.now() + LOGIN_TRANSACTION_MS).toISOString(),
    });
    const target = new URL(config.authorizationEndpoint);
    target.search = new URLSearchParams({ response_type: "code", client_id: config.clientId, redirect_uri: container.config.oidcRedirectUri, scope: (config.scopes ?? ["openid"]).join(" "), state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256" }).toString();
    reply.header("set-cookie", setOpaqueCookie(policy.loginName, binding, policy.secure, Math.floor(LOGIN_TRANSACTION_MS / 1000)));
    reply.header("cache-control", "private, no-store");
    return { authorizationUrl: target.toString() };
  });

  app.get("/auth/oidc/callback", { config: { auth: "public" } }, async (request, reply) => {
    const parsed = CallbackQuery.safeParse(request.query);
    const binding = readCookie(request.headers.cookie, policy.loginName);
    if (!parsed.success || binding === null) throw new AppError("UNAUTHORIZED", "معاملة الدخول غير صالحة", false, "warning");
    const tx = await container.authStore.consumeLoginTransaction(hashOpaqueToken(parsed.data.state), new Date().toISOString());
    if (tx === null || Date.parse(tx.expiresAt) <= Date.now() || !hashesEqual(tx.browserBindingHash, hashOpaqueToken(binding))) throw new AppError("UNAUTHORIZED", "معاملة الدخول غير صالحة أو مستخدمة", false, "warning");
    const config = await container.ssoStore.getPrivate(tx.tenantId);
    // الرفض قبل أي token exchange — الإصدار وهوية الدورة معاً:
    // إعادة إنشاء الإعداد (حتى وإن عاد الإصدار إلى 1) تولّد هوية جديدة
    // تمس المعاملة القديمة فتفشل قبل الاتصال بمزود الهوية.
    if (config === null || !config.enabled || config.configVersion !== tx.configVersion ||
        config.configInstanceId !== tx.configInstanceId || config.tokenEndpoint === undefined) throw new AppError("UNAUTHORIZED", "تغير إعداد الدخول أثناء المعاملة", false, "warning");
    const verifier = openSecret(container.keyProvider, tx.verifierEnvelope, { tenantId: tx.tenantId, resourceId: tx.transactionId, purpose: "pkce_verifier", version: 1 });
    if (!verifier.ok) throw new AppError("UNAUTHORIZED", "تعذر إكمال معاملة الدخول", false, "warning");
    const secret = config.clientSecretEnvelope === undefined ? undefined : openSecret(container.keyProvider, config.clientSecretEnvelope, { tenantId: tx.tenantId, resourceId: "sso-config", purpose: "oidc_client_secret", version: tx.configVersion });
    if (secret !== undefined && !secret.ok) throw new AppError("UNAUTHORIZED", "تعذر إكمال معاملة الدخول", false, "warning");
    let idToken: string;
    try {
      idToken = await container.oidcExchanger({ tokenEndpoint: config.tokenEndpoint, clientId: config.clientId, ...(secret?.ok ? { clientSecret: secret.value } : {}), code: parsed.data.code, verifier: verifier.value, redirectUri: tx.redirectUri });
    } catch {
      throw new AppError("SSO_UPSTREAM_FAILED", "تعذر الاتصال بمزود الهوية", false, "warning");
    }
    const verified = await verifyOidcToken(idToken, config.jwksUrl, config.issuer, config.clientId, { expectedNonce: tx.nonce });
    if (!verified.ok) throw verified.error;
    const identity = await container.authStore.findExternalIdentity(verified.value.iss, verified.value.sub);
    const membership = identity === null ? null : await container.authStore.findMembership(identity.identityId, tx.tenantId);
    if (identity === null || membership === null || membership.status !== "active") throw new AppError("UNAUTHORIZED", "الهوية غير مرتبطة بعضوية مسموحة", false, "warning");
    const issued = await sessions.issue(identity.identityId, membership, tx.browserBindingHash, "oidc");
    const maxAge = Math.floor(SESSION_ABSOLUTE_MS / 1000);
    reply.header("set-cookie", [setOpaqueCookie(policy.sessionName, issued.rawToken, policy.secure, maxAge), setCsrfCookie(issued.csrfToken, policy.secure, maxAge)]);
    reply.header("cache-control", "private, no-store");
    return reply.code(303).header("location", new URL(tx.returnPath, container.config.appOrigin).toString()).send();
  });
}
