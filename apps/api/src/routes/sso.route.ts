/**
 * إدارة SSO — عقد CAS مركب: PUT يقرأ الحالي ثم ينشئ (هوية
 * خادمية) أو يحدث بتوقع (الهوية + الإصدار) معاً؛ DELETE بتوقع مركب أيضاً.
 * عقد السر: clientSecret بديل، keepClientSecret إعادة ختم صريحة بمصادقة
 * الإصدار الحالي، والتحديث بلا سر وبلا keep يفرغ المغلف.
 * الغياب 404 (SSO_CONFIG_NOT_FOUND) والتعارض 409 (SSO_CONFIG_CONFLICT) منفصلان.
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AppError, SsoConfigSchema } from "@agentbridge/shared";
import {
  openSecret, sealSecret, SsoConfigConflictError, SsoConfigNotFoundError, type StoredSsoConfig,
} from "@agentbridge/infra";
import type { ApiContainer } from "../container.js";
import { requirePermission } from "../plugins/auth.plugin.js";

const HttpsUrl = z.string().min(1).max(500).url().refine((value) => new URL(value).protocol === "https:", "https مطلوب");
const SsoBody = z.object({
  provider: z.literal("oidc"), issuer: HttpsUrl, clientId: z.string().min(1).max(200),
  jwksUrl: HttpsUrl, authorizationEndpoint: HttpsUrl, tokenEndpoint: HttpsUrl,
  scopes: z.array(z.string().min(1).max(100)).min(1).max(10),
  clientSecret: z.string().min(8).max(2048).optional(),
  keepClientSecret: z.boolean().optional(),
  enabled: z.boolean(),
}).strict().refine((value) => value.scopes.includes("openid") && !value.scopes.includes("offline_access"), "scopes يجب أن تشمل openid دون offline_access")
  .refine((value) => !(value.clientSecret !== undefined && value.keepClientSecret === true), "لا يُرسل سر جديد مع keepClientSecret معاً");

/** يعيد ختم المغلف القائم إلى الإصدار التالي — فشل الفك رفض صريح لا صمت */
function resealExistingSecret(container: ApiContainer, current: StoredSsoConfig, tenantId: string, nextVersion: number): string {
  const opened = openSecret(container.keyProvider, current.clientSecretEnvelope ?? "", { tenantId, resourceId: "sso-config", purpose: "oidc_client_secret", version: current.configVersion });
  if (!opened.ok) throw new AppError("INVALID_INPUT", "السر القائم لا يفك بإصداره الحالي — أرسل clientSecret جديداً", false, "warning");
  return sealSecret(container.keyProvider, opened.value, { tenantId, resourceId: "sso-config", purpose: "oidc_client_secret", version: nextVersion });
}

function requireSessionAdmin(request: Parameters<typeof requirePermission>[0]) {
  const context = requirePermission(request, "sso:manage");
  if (context.principal.actorType !== "user") throw new AppError("FORBIDDEN", "إدارة SSO تتطلب جلسة مستخدم", false, "warning");
  return context;
}

export function registerSsoRoutes(app: FastifyInstance, container: ApiContainer): void {
  app.get("/sso/config", async (request) => {
    const context = requireSessionAdmin(request);
    const config = await container.ssoStore.get(context.tenantId);
    if (config === null) throw new AppError("NOT_FOUND", "لا يوجد إعداد SSO لهذا المستأجر");
    return { config };
  });

  app.put("/sso/config", async (request) => {
    const context = requireSessionAdmin(request);
    const parsed = SsoBody.safeParse(request.body);
    if (!parsed.success) throw new AppError("INVALID_INPUT", parsed.error.message);
    const current = await container.ssoStore.getPrivate(context.tenantId);
    const writeInput = await ssoWriteInput(container, context, parsed.data, current);
    try {
      if (current === null) return { config: await container.ssoStore.create(writeInput) };
      return {
        config: await container.ssoStore.update(writeInput, {
          expectedInstanceId: current.configInstanceId, expectedVersion: current.configVersion,
        }),
      };
    } catch (error) {
      if (error instanceof SsoConfigConflictError) throw new AppError("SSO_CONFIG_CONFLICT", error.message, true, "warning");
      if (error instanceof SsoConfigNotFoundError) throw new AppError("NOT_FOUND", error.message);
      throw error;
    }
  });

  app.delete("/sso/config", async (request) => {
    const context = requireSessionAdmin(request);
    const current = await container.ssoStore.getPrivate(context.tenantId);
    try {
      const deleted = await container.ssoStore.delete(
        context.tenantId,
        current === null ? undefined : { expectedInstanceId: current.configInstanceId, expectedVersion: current.configVersion },
      );
      if (!deleted) throw new AppError("NOT_FOUND", "لا يوجد إعداد SSO لهذا المستأجر");
      return { deleted: true };
    } catch (error) {
      if (error instanceof SsoConfigConflictError) throw new AppError("SSO_CONFIG_CONFLICT", error.message, true, "warning");
      throw error;
    }
  });
}

/** يبني مدخل الكتابة ويفرض عقد السر قبل المخزن — enabled=true بلا سر رفض */
async function ssoWriteInput(
  container: ApiContainer, context: ReturnType<typeof requirePermission>,
  body: z.infer<typeof SsoBody>, current: StoredSsoConfig | null,
) {
  const nextVersion = (current?.configVersion ?? 0) + 1;
  let clientSecretEnvelope: string | undefined;
  if (body.clientSecret !== undefined) {
    clientSecretEnvelope = sealSecret(container.keyProvider, body.clientSecret, { tenantId: context.tenantId, resourceId: "sso-config", purpose: "oidc_client_secret", version: nextVersion });
  } else if (body.keepClientSecret === true) {
    if (current?.clientSecretEnvelope === undefined) throw new AppError("INVALID_INPUT", "لا يوجد سر قائم لإبقائه — أرسل clientSecret", false, "warning");
    clientSecretEnvelope = resealExistingSecret(container, current, context.tenantId, nextVersion);
  }
  if (body.enabled && clientSecretEnvelope === undefined) {
    throw new AppError("INVALID_INPUT", "تفعيل عميل OIDC confidential يستلزم سراً — أرسل clientSecret أو keepClientSecret=true", false, "warning");
  }
  const candidate = {
    tenantId: context.tenantId, provider: body.provider, issuer: body.issuer,
    clientId: body.clientId, jwksUrl: body.jwksUrl,
    authorizationEndpoint: body.authorizationEndpoint, tokenEndpoint: body.tokenEndpoint,
    scopes: body.scopes, enabled: body.enabled,
    ...(clientSecretEnvelope !== undefined ? { clientSecretEnvelope } : {}),
  };
  // التحقق المخططي على الحقول العامة حصراً — المغلف الداخلي ليس جزءاً من العقد
  const publicFields: Record<string, unknown> = { ...candidate };
  delete publicFields.clientSecretEnvelope;
  if (!SsoConfigSchema.omit({ configInstanceId: true, configVersion: true, clientSecretConfigured: true }).safeParse(publicFields).success) {
    throw new AppError("INVALID_INPUT", "إعداد SSO غير صالح");
  }
  return candidate;
}
