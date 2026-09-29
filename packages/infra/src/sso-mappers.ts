/**
 * مبدئو SSO — دوال نقية بين سجل النطاق وصف الجدول (بلا أي منطق جانبي).
 *
 * عقد الكتابة: هوية الدورة والإصدار قرارات خادم — لا يقرأهما المبدئو من مدخل
 * الكتابة إطلاقاً؛ صف التحديث يستثني config_instance_id حصراً فلا دهس بهوية
 * قديمة (جذر ABA). القيم القادمة من صفوف القاعدة موثقة بصيغة صارمة.
 */
import type { SsoConfigWriteInput, StoredSsoConfig } from "./sso-store.js";

export interface SsoConfigRow {
  readonly tenant_id: string;
  readonly provider: string;
  readonly issuer: string;
  readonly client_id: string;
  readonly jwks_url: string;
  readonly authorization_endpoint?: string | null;
  readonly token_endpoint?: string | null;
  readonly scopes?: string;
  readonly client_secret_envelope?: string | null;
  readonly config_version?: number;
  readonly config_instance_id: string;
  readonly enabled: boolean;
  readonly created_at: Date;
}

/** صف الإنشاء: هوية خادمية مولدة حديثاً وإصدار 1 — لا مدخل خارجي لهما */
export function ssoCreateRow(config: SsoConfigWriteInput, configInstanceId: string): SsoConfigRow {
  return {
    ...ssoCommonColumns(config),
    config_instance_id: configInstanceId,
    config_version: 1,
    created_at: new Date(),
  };
}

/** صف التحديث: يستثني config_instance_id حصراً — الهوية لا تتغير بالتحديث */
export function ssoUpdateRow(config: SsoConfigWriteInput, nextVersion: number): Omit<SsoConfigRow, "config_instance_id" | "created_at"> {
  return {
    tenant_id: config.tenantId,
    provider: config.provider,
    issuer: config.issuer,
    client_id: config.clientId,
    jwks_url: config.jwksUrl,
    authorization_endpoint: config.authorizationEndpoint ?? null,
    token_endpoint: config.tokenEndpoint ?? null,
    scopes: JSON.stringify(config.scopes ?? ["openid"]),
    client_secret_envelope: config.clientSecretEnvelope ?? null,
    config_version: nextVersion,
    enabled: config.enabled,
  };
}

function ssoCommonColumns(config: SsoConfigWriteInput): Omit<SsoConfigRow, "config_instance_id" | "config_version" | "created_at"> {
  return {
    tenant_id: config.tenantId,
    provider: config.provider,
    issuer: config.issuer,
    client_id: config.clientId,
    jwks_url: config.jwksUrl,
    authorization_endpoint: config.authorizationEndpoint ?? null,
    token_endpoint: config.tokenEndpoint ?? null,
    scopes: JSON.stringify(config.scopes ?? ["openid"]),
    client_secret_envelope: config.clientSecretEnvelope ?? null,
    enabled: config.enabled,
  };
}

/** قراءة صف إلى سجل داخلي — هوية وإصدار مطلوبان، القيم القديمة تُوثق لا تُخترع */
export function ssoFromRow(row: SsoConfigRow): StoredSsoConfig {
  let scopes: string[] = ["openid"];
  try {
    const parsed: unknown = JSON.parse(row.scopes ?? "[\"openid\"]");
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) scopes = parsed;
  } catch {
    // سجل تالف يبقى على openid فقط — لا اكتشاف صامت لقيم أخرى
  }
  return {
    tenantId: row.tenant_id,
    provider: row.provider,
    issuer: row.issuer,
    clientId: row.client_id,
    jwksUrl: row.jwks_url,
    ...(row.authorization_endpoint != null ? { authorizationEndpoint: row.authorization_endpoint } : {}),
    ...(row.token_endpoint != null ? { tokenEndpoint: row.token_endpoint } : {}),
    scopes,
    configVersion: row.config_version ?? 1,
    configInstanceId: row.config_instance_id,
    ...(row.client_secret_envelope != null ? { clientSecretEnvelope: row.client_secret_envelope } : {}),
    enabled: row.enabled,
  };
}
