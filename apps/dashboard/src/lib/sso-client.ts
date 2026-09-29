/**
 * عميل SSO — غلاف نقي فوق fetch عبر وكيل /api الداخلي.
 *
 * ماهيته: قراءة/حفظ/حذف إعداد SSO وبدء authorization-code.
 * وظيفته: يغذي صفحة /settings/sso بنموذج حتمي بلا تسريب مفاتيح.
 * كيف: session cookie وCSRF؛ السر write-only ولا يُقرأ من الخادم.
 */

import { ApiError, type Credentials } from "./api-client";
import { sessionFetch } from "./session-fetch";

export interface SsoConfig {
  readonly tenantId: string;
  readonly provider: string;
  readonly issuer: string;
  readonly clientId: string;
  readonly jwksUrl: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly scopes: readonly string[];
  readonly clientSecretConfigured: boolean;
  readonly configVersion: number;
  readonly enabled: boolean;
}

export interface SsoConfigInput {
  readonly provider: "oidc";
  readonly issuer: string;
  readonly clientId: string;
  readonly jwksUrl: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly scopes: readonly string[];
  readonly clientSecret?: string;
  readonly enabled: boolean;
}

async function requestJson<T>(_session: Credentials, path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined) headers.set("content-type", "application/json");
  const response = await sessionFetch(`/api${path}`, { ...(init ?? {}), headers });
  const text = await response.text();
  if (!response.ok) {
    let message = ""; // الرسالة من الخادم إن وجدت — وإلا تُترجم محلياً
    try {
      const envelope = JSON.parse(text) as { error?: { message?: string } };
      if (envelope.error?.message !== undefined) message = envelope.error.message;
    } catch { /* إبقاء العامة */ }
    throw new ApiError(response.status, `HTTP_${response.status}`, message);
  }
  return (text.length === 0 ? ({} as T) : (JSON.parse(text) as T));
}

export const ssoClient = {
  getConfig: (creds: Credentials) => requestJson<{ config: SsoConfig }>(creds, "/sso/config"),
  upsert: (creds: Credentials, body: SsoConfigInput) =>
    requestJson<{ config: SsoConfig }>(creds, "/sso/config", { method: "PUT", body: JSON.stringify(body) }),
  remove: (creds: Credentials) => requestJson<{ deleted: boolean }>(creds, "/sso/config", { method: "DELETE" }),
  start: (tenantId: string, returnPath = "/app") =>
    requestJson<{ authorizationUrl: string }>({ tenantId }, "/auth/oidc/start", { method: "POST", body: JSON.stringify({ tenantId, returnPath }) }),
};
