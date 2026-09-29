/**
 * بدائيات الجلسة — CSPRNG للقيم الخام وSHA-256 للقيم المخزنة.
 * المقارنات تتم على hashes ثابتة الطول ولا تسجل أي قيمة خام.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_ABSOLUTE_MS = 8 * 60 * 60 * 1000;
export const LOGIN_TRANSACTION_MS = 5 * 60 * 1000;

export function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashOpaqueToken(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hashesEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
