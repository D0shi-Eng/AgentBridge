/**
 * مدقق ID token — يفصل صحة الرمز عن ربط العضوية والمستأجر.
 * المفاتيح تأتي حصراً من إعداد JWKS الموثوق؛ لا jku/x5u من المهاجم.
 */
import { createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { AppError, err, ok, type Result, type SsoTokenClaims } from "@agentbridge/shared";
import { fetchJwks } from "./jwks/client.js";
import { JWKS_SAFE_MESSAGE } from "./jwks/policy.js";
import type { JwkPublicKey, JwksResponse } from "./jwks/schema.js";

const MAX_TOKEN_BYTES = 16 * 1024;
const DEFAULT_SKEW_SECONDS = 60;

function decodePart(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function encodePart(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export const SsoErrors = {
  jwksFailed: () => new AppError("SSO_JWKS_FAILED", JWKS_SAFE_MESSAGE, false, "warning"),
  tokenInvalid: (detail: string) => new AppError("SSO_TOKEN_INVALID", `رمز OIDC غير صالح: ${detail}`, false, "warning"),
  issuerMismatch: () => new AppError("SSO_ISSUER_MISMATCH", "مصدر الرمز لا يطابق الإعداد الموثوق", false, "warning"),
} as const;

export interface OidcVerificationOptions {
  readonly expectedNonce?: string;
  readonly nowSeconds?: number;
  readonly clockSkewSeconds?: number;
}

/**
 * اختيار مفتاح التحقق: sig/RS256 حصراً — مفاتيح enc في JWKS الحقيقية
 * (Keycloak مثلاً) ليست للتحقق من التواقيع ولا تُختار أبداً.
 */
function usableForSignature(key: JwkPublicKey): boolean {
  if (key.use !== undefined && key.use !== "sig") return false;
  return key.alg === undefined || key.alg === "RS256";
}

function selectKey(jwks: JwksResponse, kid: string | null): JwkPublicKey | null {
  const usable = jwks.keys.filter(usableForSignature);
  if (kid !== null) return usable.find((key) => key.kid === kid) ?? null;
  return usable.length === 1 ? (usable[0] ?? null) : null;
}

function audienceValid(payload: Record<string, unknown>, clientId: string): boolean {
  const aud = payload["aud"];
  const list = typeof aud === "string" ? [aud] : Array.isArray(aud) && aud.every((item) => typeof item === "string") ? aud : [];
  if (!list.includes(clientId)) return false;
  const azp = payload["azp"];
  return list.length <= 1 ? azp === undefined || azp === clientId : azp === clientId;
}

export async function verifyOidcToken(
  token: string,
  jwksUrl: string,
  issuer: string,
  clientId: string,
  options: OidcVerificationOptions = {},
): Promise<Result<SsoTokenClaims>> {
  if (Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) return err(SsoErrors.tokenInvalid("الحجم يتجاوز الحد"));
  const parts = token.split(".");
  if (parts.length !== 3) return err(SsoErrors.tokenInvalid("صيغة JWT غير صحيحة"));
  const header = decodePart(parts[0] ?? "");
  const payload = decodePart(parts[1] ?? "");
  if (header === null || payload === null || header["alg"] !== "RS256" || header["jku"] !== undefined || header["x5u"] !== undefined) {
    return err(SsoErrors.tokenInvalid("رأس أو خوارزمية غير مدعومة"));
  }
  let jwks: JwksResponse;
  try { jwks = await fetchJwks(jwksUrl); } catch { return err(SsoErrors.jwksFailed()); }
  const kid = typeof header["kid"] === "string" && header["kid"].length > 0 ? header["kid"] : null;
  const jwk = selectKey(jwks, kid);
  if (jwk === null) return err(SsoErrors.tokenInvalid("اختيار المفتاح غير محسوم"));
  try {
    const key = createPublicKey({ key: jwk, format: "jwk" });
    const signed = Buffer.from(`${parts[0]}.${parts[1]}`, "utf8");
    if (!verify("RSA-SHA256", signed, key, Buffer.from(parts[2] ?? "", "base64url"))) return err(SsoErrors.tokenInvalid("توقيع غير صالح"));
  } catch { return err(SsoErrors.tokenInvalid("تعذر التحقق من التوقيع")); }

  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const skew = options.clockSkewSeconds ?? DEFAULT_SKEW_SECONDS;
  const iss = typeof payload["iss"] === "string" ? payload["iss"] : "";
  const sub = typeof payload["sub"] === "string" ? payload["sub"] : "";
  const exp = typeof payload["exp"] === "number" ? payload["exp"] : -1;
  const nbf = typeof payload["nbf"] === "number" ? payload["nbf"] : undefined;
  const iat = typeof payload["iat"] === "number" ? payload["iat"] : undefined;
  if (iss !== issuer) return err(SsoErrors.issuerMismatch());
  if (!audienceValid(payload, clientId)) return err(SsoErrors.tokenInvalid("aud/azp لا يطابق العميل"));
  if (sub.length === 0 || sub.length > 500) return err(SsoErrors.tokenInvalid("sub مفقود أو كبير"));
  if (!Number.isInteger(exp) || exp < now - skew) return err(SsoErrors.tokenInvalid("انتهت صلاحية الرمز"));
  if (nbf !== undefined && (!Number.isInteger(nbf) || nbf > now + skew)) return err(SsoErrors.tokenInvalid("nbf في المستقبل"));
  if (iat !== undefined && (!Number.isInteger(iat) || iat > now + skew)) return err(SsoErrors.tokenInvalid("iat في المستقبل"));
  const nonce = typeof payload["nonce"] === "string" ? payload["nonce"] : undefined;
  if (options.expectedNonce !== undefined && nonce !== options.expectedNonce) return err(SsoErrors.tokenInvalid("nonce غير مطابق"));
  const email = typeof payload["email"] === "string" ? payload["email"] : undefined;
  return ok({ sub, exp, iss, ...(email !== undefined ? { email } : {}), ...(nonce !== undefined ? { nonce } : {}) });
}

/** مساعد اختبار فقط لإنشاء RS256 محلي بلا شبكة أو أسرار مستخدم. */
export function signOidcToken(payload: Record<string, unknown>, privateJwk: Record<string, unknown>, kid: string): string {
  const header = encodePart({ alg: "RS256", typ: "JWT", kid });
  const body = encodePart(payload);
  const key = createPrivateKey({ key: privateJwk, format: "jwk" });
  return `${header}.${body}.${sign("RSA-SHA256", Buffer.from(`${header}.${body}`), key).toString("base64url")}`;
}
