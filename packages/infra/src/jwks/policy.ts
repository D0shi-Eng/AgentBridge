/** سياسة مشغل المنصة فقط؛ غياب القائمة يمنع JWKS ولا يمنح tenant admin صلاحية شبكة. */
import { z } from "zod";
import { isPublicAddress } from "./ip-policy.js";
import { isIP } from "node:net";

export const JWKS_LIMITS = { timeoutMs: 5000, maxBytes: 262144, maxConcurrent: 8 } as const;
export const JWKS_SAFE_MESSAGE = "تعذر التحقق من مفاتيح الهوية — Identity keys could not be verified";
export function jwksFailure(): Error { return new Error(JWKS_SAFE_MESSAGE); }

/**
 * الاستثناء المحلي المحصور (قسم 7C من برومبت المرحلة الثانية): بيئات
 * الاختبار تحتاج IdP على loopback — الفتح يستلزم متغيراً صريحاً **و**
 * غياب الإنتاج؛ الإنتاج يرفض الاثنين معاً fail-closed حتى لو أُصيب
 * المتغير خطأً. الاستثناء لا يدخل production config أبداً.
 */
export function loopbackAllowed(): boolean {
  return process.env.JWKS_ALLOW_LOOPBACK === "true" && process.env.NODE_ENV !== "production";
}

/** مضيفو الالتفاف الثلاثة فقط — لا نطاقات تحمل نقاطاً تتحايل على السياسة */
export function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

const Host = z.string().min(1).max(253).refine((host) => {
  if (isLoopbackHost(host)) return loopbackAllowed();
  if (isIP(host)) return isPublicAddress(host);
  return host.includes(".") && host.split(".").every((label) =>
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(label));
});
export const JwksHostsSchema = z.string().max(8192).default("").transform((value) =>
  value === "" ? [] : value.split(",").map((host) => host.trim().toLowerCase()),
).pipe(z.array(Host).max(32));

export function allowedJwksUrl(raw: string, hosts: readonly string[]): URL {
  if (raw.length > 2048) throw jwksFailure();
  const url = new URL(raw);
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const loopbackException = loopbackAllowed() && isLoopbackHost(hostname);
  if (url.protocol !== "https:" || url.username || url.password || url.hash ||
      (url.port !== "" && url.port !== "443" && !loopbackException) || !hosts.includes(hostname) ||
      (isIP(hostname) !== 0 && !isPublicAddress(hostname) && !loopbackException)) throw jwksFailure();
  return url;
}
