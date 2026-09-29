"use client";

/**
 * بطاقة الاتصال المحلي — التثبيت الفردي على جهاز واحد.
 * الجلسة تُؤسس تلقائياً دون أي إدخال من المستخدم: بلا معرف مساحة عمل،
 * بلا مفتاح API، وبلا رمز في الرابط أو سجل المتصفح — فتح /app يكفي.
 * الفشل يعرض سبباً تشغيلياً واحداً مع زر إعادة محاولة، ولا يوجد مسار
 * تراجع إلى شاشة المفتاح في هذا الوضع إطلاقاً.
 * لا تخزين لأي اعتماد في Web Storage إطلاقاً.
 */

import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "@/lib/api-client";
import { t, useLocale } from "@/lib/i18n";
import { Logo } from "@/components/ui/Logo";

export function LocalConnectCard({ onLogin }: {
  readonly onLogin: (session: { tenantId: string }) => void;
}) {
  const { locale } = useLocale();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);

  async function connect(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.localSession();
      const session = await api.session();
      onLogin({ tenantId: session.tenantId });
    } catch (cause) {
      // انقطاع الشبكة وحده يُميَّز؛ أي رفض آخر رسالة تشغيلية واحدة
      // بلا تفاصيل داخلية — والإعادة من المستخدم لا من حلقة صامتة
      setError(cause instanceof ApiError && cause.status >= 500 ? t("login.networkError", locale) : t("login.local.failed", locale));
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!started.current) {
      started.current = true;
      void connect();
    }
  }, []);

  return (
    <div className="card fade-up" style={{ maxWidth: 460, margin: "60px auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "center", marginBottom: 6 }}>
        <Logo size={34} />
        <h2 style={{ fontSize: "var(--text-1)" }}>{t("login.local.title", locale)}</h2>
      </div>
      {error !== null && (
        <>
          <div role="alert" className="error-box" style={{ marginBottom: 12 }}>{error}</div>
          <p style={{ textAlign: "center" }}>
            <button type="button" className="btn" onClick={() => void connect()}>{t("login.local.retry", locale)}</button>
          </p>
        </>
      )}
      {busy && (
        <p style={{ textAlign: "center", fontSize: "var(--text--1)", color: "var(--muted)" }} aria-live="polite">
          {t("login.local.working", locale)}
        </p>
      )}
    </div>
  );
}
