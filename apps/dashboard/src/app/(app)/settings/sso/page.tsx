"use client";

/**
 * صفحة إعدادات SSO/OIDC للمؤسسات — نموذج حتمي مع عزل مستأجر.
 *
 * ماهيتها: نموذج issuer/clientId/jwksUrl/enabled + سر كتابة-فقط وزر حفظ/حذف.
 * وظيفتها: تمكين tenantAdmin من ضبط SSO لمستأجره بلا تسريب لمستأجر آخر.
 * كيف: sso-client النقي + حالات مستقلة (not-configured/loading/configured/
 * forbidden/unreachable) وفصل واضح بين الفشل والغياب، وسر
 * العميل لا يُعاد قراءته أبداً — حقله فارغ = إبقاء، مملوء = استبدال.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ssoClient } from "@/lib/sso-client";
import { ApiError } from "@/lib/api-client";
import { useSession } from "@/lib/use-session";
import { apiErrorMessage, t, useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { SkeletonCard } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { useToast } from "@/components/ui/ToastProvider";
import { Breadcrumbs } from "@/components/system/AppShell";

/** حالات القراءة المستقلة — كل واحدة رسالتها وإجراءها الخاص */
type LoadState = "configured" | "empty" | "forbidden" | "unreachable";

export default function SsoPage() {
  const toast = useToast();
  const { locale } = useLocale();
  const { session: creds, ready } = useSession();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [jwksUrl, setJwksUrl] = useState("");
  const [authorizationEndpoint, setAuthorizationEndpoint] = useState("");
  const [tokenEndpoint, setTokenEndpoint] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [secretConfigured, setSecretConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>("empty");

  const load = useCallback(async () => {
    if (creds === null) { setLoading(false); return; }
    setLoading(true);
    try {
      const result = await ssoClient.getConfig(creds);
      setIssuer(result.config.issuer);
      setClientId(result.config.clientId);
      setJwksUrl(result.config.jwksUrl);
      setAuthorizationEndpoint(result.config.authorizationEndpoint);
      setTokenEndpoint(result.config.tokenEndpoint);
      setEnabled(result.config.enabled);
      setSecretConfigured(result.config.clientSecretConfigured);
      setLoadState("configured");
    } catch (error) {
      // 404 = لا إعداد (حالة سليمة) — 403 = لا صلاحية — الباقي فشل وصول
      setLoadState(
        error instanceof ApiError && error.status === 404 ? "empty"
          : error instanceof ApiError && error.status === 403 ? "forbidden"
            : "unreachable",
      );
    } finally { setLoading(false); }
  }, [creds]);

  useEffect(() => { void load(); }, [load]);

  async function onSave(): Promise<void> {
    if (creds === null) return;
    setSaving(true);
    try {
      await ssoClient.upsert(creds, {
        provider: "oidc", issuer, clientId, jwksUrl, authorizationEndpoint,
        tokenEndpoint, scopes: ["openid", "profile", "email"],
        // سر فارغ = إبقاء المحفوظ؛ قيمة جديدة = استبدال — لا إرسال فراغ يفسد السر
        ...(clientSecret.length > 0 ? { clientSecret } : {}), enabled,
      });
      setClientSecret("");
      setSecretConfigured(true);
      setLoadState("configured");
      toast.success(t("sso.saved", locale));
    } catch (error) { toast.error(apiErrorMessage(error, locale, "sso.saveFailed")); }
    finally { setSaving(false); }
  }

  async function onDelete(): Promise<void> {
    if (creds === null) return;
    const confirmed = typeof window !== "undefined" ? window.confirm(t("sso.delete", locale)) : true;
    if (!confirmed) return;
    try {
      await ssoClient.remove(creds);
      setIssuer(""); setClientId(""); setJwksUrl(""); setAuthorizationEndpoint(""); setTokenEndpoint(""); setClientSecret(""); setEnabled(false); setSecretConfigured(false); setLoadState("empty");
      toast.success(t("sso.deleted", locale));
    } catch (error) { toast.error(apiErrorMessage(error, locale, "sso.deleteFailed")); }
  }

  if (!ready) return <div className="wrap"><SkeletonCard /></div>;
  if (creds === null) {
    return (
      <div className="wrap">
        <Card title={t("run.sessionExpiredTitle", locale)}>
          <Link className="btn green" href="/app">{t("error.returnToLogin", locale)}</Link>
        </Card>
      </div>
    );
  }

  const fieldStyle: React.CSSProperties = { width: "100%", marginTop: 4 };
  const urlField = (value: string, setter: (next: string) => void, label: string, placeholder: string, id: string) => (
    <label htmlFor={id}>{label}
      <input id={id} dir="ltr" type="url" value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder} style={fieldStyle} />
    </label>
  );

  return (
    <div className="wrap">
      <Breadcrumbs items={[
        { label: t("breadcrumb.overview", locale), href: "/app" },
        { label: t("breadcrumb.sso", locale) },
      ]} />
      <header className="topbar">
        <h1 style={{ fontSize: "var(--text-2)" }}>{t("sso.title", locale)}</h1>
      </header>

      <div className="card">
        {loading ? (<SkeletonCard />) : (
          <>
            {/* شارة الحالة النصية — لا اعتماد على اللون وحده. عند forbidden
                الحالة مجهولة لنا فلا نعلن «غير مهيأ» ولا «مهيأ» إطلاقاً */}
            {(loadState === "configured" || loadState === "empty") && (
              <p style={{ marginBottom: 12, fontSize: "var(--text--1)" }}>
                <span className={`pill ${loadState === "configured" ? "completed" : "neutral"}`}>
                  {t(loadState === "configured" ? "sso.configuredBadge" : "sso.notConfiguredBadge", locale)}
                </span>
              </p>
            )}

            {loadState === "empty" && <EmptyState icon="🔐" title={t("sso.emptyTitle", locale)} hint={t("sso.emptyHint", locale)} />}

            {/* لا صلاحية — تجربة ناضجة: عنوان وشرح ومن يستطيع وCTA آمن،
                بلا تفاصيل تفويض داخلية ولا مساحة فارغة بلا هدف */}
            {loadState === "forbidden" && (
              <section role="alert" className="forbidden-panel" aria-labelledby="sso-forbidden-title">
                <div className="forbidden-icon" aria-hidden="true">
                  <svg width="34" height="34" viewBox="0 0 24 24" focusable="false">
                    <rect x="5" y="10.5" width="14" height="9" rx="2" fill="currentColor" opacity="0.85" />
                    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </div>
                <h2 id="sso-forbidden-title">{t("sso.forbiddenTitle", locale)}</h2>
                <p>{t("sso.forbiddenBody", locale)}</p>
                <p style={{ color: "var(--muted)" }}>{t("sso.forbiddenWho", locale)}</p>
                <Link className="btn primary" href="/app">{t("sso.forbiddenCta", locale)}</Link>
              </section>
            )}

            {/* تعذر الوصول — خطأ شبكة/خادم مع زر إعادة، لا يعرض كغياب تهيئة */}
            {loadState === "unreachable" && (
              <div role="alert">
                <div className="error-box">{t("sso.loadFailed", locale)}</div>
                <Button variant="ghost" onClick={() => void load()}>{t("common.retry", locale)}</Button>
              </div>
            )}

            {loadState !== "forbidden" && (
              <form style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); void onSave(); }}>
                {urlField(issuer, setIssuer, t("sso.issuer", locale), "https://issuer.example.com", "sso-issuer")}
                <label htmlFor="sso-client-id">{t("sso.clientId", locale)}
                  <input id="sso-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="client-id" style={fieldStyle} />
                </label>
                {urlField(jwksUrl, setJwksUrl, t("sso.jwksUrl", locale), "https://issuer.example.com/.well-known/jwks.json", "sso-jwks")}
                {urlField(authorizationEndpoint, setAuthorizationEndpoint, t("sso.authorizationEndpoint", locale), "https://issuer.example.com/authorize", "sso-authz")}
                {urlField(tokenEndpoint, setTokenEndpoint, t("sso.tokenEndpoint", locale), "https://issuer.example.com/token", "sso-token")}

                <label htmlFor="sso-secret">{t("sso.clientSecret", locale)}
                  <input id="sso-secret" dir="ltr" type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" style={fieldStyle} />
                </label>
                <p style={{ color: "var(--muted)", fontSize: "var(--text--2)" }}>
                  {t(secretConfigured ? "sso.clientSecretConfigured" : "sso.clientSecretNotConfigured", locale)}
                </p>

                <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> {t("sso.enabled", locale)}
                </label>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Button type="submit" variant="primary" busy={saving}>{t("sso.save", locale)}</Button>
                  <Button variant="red" onClick={() => void onDelete()}>{t("sso.delete", locale)}</Button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
