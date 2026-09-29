/**
 * مغلف أسرار AEAD — يربط النص المشفر بالمستأجر والمورد والغرض والإصدار.
 * لا يملك المفتاح؛ KeyProvider الصغير يسمح بتدوير keyId دون KMS محلي زائف.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { AppError, err, ok, type Result } from "@agentbridge/shared";

export interface KeyProvider {
  current(): { readonly keyId: string; readonly key: Buffer };
  byId(keyId: string): Buffer | null;
}

export interface SecretContext {
  readonly tenantId: string;
  readonly resourceId: string;
  readonly purpose: "oidc_client_secret" | "pkce_verifier";
  readonly version: number;
}

function aad(context: SecretContext): Buffer {
  return Buffer.from(JSON.stringify([
    context.tenantId, context.resourceId, context.purpose, context.version,
  ]), "utf8");
}

export function createStaticKeyProvider(key: Buffer, keyId = "local-v1"): KeyProvider {
  if (key.length !== 32) throw new AppError("CONFIG_INVALID", "مفتاح AEAD يجب أن يكون 32 بايت");
  return { current: () => ({ keyId, key }), byId: (candidate) => candidate === keyId ? key : null };
}

export function sealSecret(provider: KeyProvider, plaintext: string, context: SecretContext): string {
  const { keyId, key } = provider.current();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(context));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", keyId, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(":");
}

export function openSecret(provider: KeyProvider, envelope: string, context: SecretContext): Result<string> {
  const parts = envelope.split(":");
  if (parts.length !== 5 || parts[0] !== "v1") return err(new AppError("CRYPTO_MALFORMED_ENVELOPE", "مغلف السر غير مدعوم"));
  const key = provider.byId(parts[1] ?? "");
  if (key === null) return err(new AppError("CRYPTO_KEY_UNAVAILABLE", "مفتاح فك السر غير متاح", false, "critical"));
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[2] ?? "", "base64url"));
    decipher.setAAD(aad(context));
    decipher.setAuthTag(Buffer.from(parts[3] ?? "", "base64url"));
    const value = Buffer.concat([decipher.update(Buffer.from(parts[4] ?? "", "base64url")), decipher.final()]).toString("utf8");
    return ok(value);
  } catch {
    return err(new AppError("CRYPTO_DECRYPT_FAILED", "فشل التحقق من سر مشفر", false, "critical"));
  }
}
