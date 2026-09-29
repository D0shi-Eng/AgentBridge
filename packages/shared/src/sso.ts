/**
 * أنواع SSO/OIDC للمؤسسات — عقد النطاق البنيوي.
 *
 * ماهيته: نوعان صارمان SsoConfig و SsoTokenClaims بمخططات Zod تحمي كل حدود الدخول.
 * وظيفته: يضمن أن issuer وjwksUrl لا يمران إلا بـ https، وclientId بطول 1..200، وتمنع أي JWK http.
 * كيف: مخططات Zod strict + تحقق https عبر URL + تصدير أنواع مستنتجة بلا any.
 */

import { z } from "zod";

// تحقق https فقط — يرفض http وftp وغيرها
function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

// مخطط إعداد SSO للمستأجر — كل حقل صارم
export const SsoConfigSchema = z
  .object({
    tenantId: z.string().min(1).max(200),
    provider: z.string().min(1).max(50),
    issuer: z.string().min(1).max(500).refine(isHttpsUrl, { message: "issuer يجب أن يبدأ بـ https://" }),
    clientId: z.string().min(1).max(200),
    jwksUrl: z.string().min(1).max(500).refine(isHttpsUrl, { message: "jwksUrl يجب أن يبدأ بـ https://" }),
    authorizationEndpoint: z.string().max(500).refine((value) => value.length === 0 || isHttpsUrl(value), { message: "authorizationEndpoint يجب أن يكون https" }).optional(),
    tokenEndpoint: z.string().max(500).refine((value) => value.length === 0 || isHttpsUrl(value), { message: "tokenEndpoint يجب أن يكون https" }).optional(),
    scopes: z.array(z.string().min(1).max(100)).max(10).optional(),
    clientSecretConfigured: z.boolean().optional(),
    configVersion: z.number().int().positive().optional(),
    /** هوية دورة الإعداد — مجالاً عاماً لا يحتاج إخفاء ولا كشف معلومة حساسة */
    configInstanceId: z.string().min(1).max(200).optional(),
    enabled: z.boolean(),
  })
  .strict();

export type SsoConfig = z.infer<typeof SsoConfigSchema>;

// مطالبات الرمز المميز بعد التحقق — حتمية
export const SsoTokenClaimsSchema = z
  .object({
    sub: z.string().min(1).max(500),
    email: z.string().email().optional(),
    exp: z.number().int().positive(),
    iss: z.string().min(1).refine(isHttpsUrl, { message: "iss يجب أن يبدأ بـ https://" }),
    nonce: z.string().min(1).max(500).optional(),
  })
  .strict();

export type SsoTokenClaims = z.infer<typeof SsoTokenClaimsSchema>;
