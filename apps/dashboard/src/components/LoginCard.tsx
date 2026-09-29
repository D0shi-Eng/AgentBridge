"use client";

/**
 * بطاقة الدخول — تبدل مفتاح API بجلسة كوكيز HttpOnly وتمسح الحقل فوراً.
 * المفتاح لا يُحفظ في أي تخزين، والحقل type=password بautocomplete مناسب،
 * والخطأ يُعلن بـrole=alert وينال التركيز — بلا كشف أي تفاصيل داخلية.
 */

import { useRef, useState } from "react";
import { api, ApiError, type Credentials } from "@/lib/api-client";
import { t, useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { Logo } from "@/components/ui/Logo";

export function LoginCard({ onLogin }: { onLogin: (session: Credentials) => void }) {
  const [tenantId, setTenantId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const { locale } = useLocale();

  async function submit(): Promise<void> {
    if (tenantId.trim().length === 0 || apiKey.trim().length === 0) {
      setError(t("login.requiredError", locale));
      queueMicrotask(() => errorRef.current?.focus());
      return;
    }
    setBusy(true); setError(null);
    try {
      await api.login(tenantId.trim(), apiKey);
      setApiKey("");
      const session = await api.session();
      onLogin({ tenantId: session.tenantId, permissions: session.permissions });
    } catch (cause) {
      setApiKey("");
      // فشل الدخول رسالة واحدة عامة — لا نميز وجود المعرف عن صحة المفتاح
      // كي لا نساعد التخمين؛ انقطاع الشبكة وحده يُميَّز ليردى الفرق
      setError(cause instanceof ApiError && cause.status >= 500 ? t("login.networkError", locale) : t("login.failedError", locale));
      queueMicrotask(() => errorRef.current?.focus());
    } finally { setBusy(false); }
  }

  return (
    <div className="card fade-up" style={{ maxWidth: 460, margin: "60px auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 6 }}>
        <Logo size={34} />
        <h2 style={{ fontSize: "var(--text-1)" }}>{t("login.title", locale)}</h2>
      </div>
      <p style={{ color: "var(--muted)", fontSize: "var(--text--1)", marginBottom: 16, textAlign: "center" }}>
        {t("login.hint", locale)}
      </p>
      {error !== null && (
        <div ref={errorRef} tabIndex={-1} role="alert" className="error-box">{error}</div>
      )}
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <label className="field">
          <span>{t("login.tenantId", locale)}</span>
          <input
            type="text"
            value={tenantId}
            onChange={(e) => setTenantId(e.target.value)}
            placeholder="clinic-demo"
            dir="ltr"
            autoComplete="username"
            required
          />
        </label>
        <label className="field">
          <span>{t("login.apiKey", locale)}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="ab_…"
            dir="ltr"
            autoComplete="current-password"
            required
          />
        </label>
        <Button type="submit" variant="green" disabled={busy} onClick={() => undefined}>
          {busy ? t("login.submitting", locale) : t("login.submit", locale)}
        </Button>
      </form>
    </div>
  );
}
