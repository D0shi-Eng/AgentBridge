"use client";

/**
 * صفحة التحقق العامة — الوجه الذي يفتحه أي زائر يحمل شارة عميل.
 * تعرض القرار والدرجة والزمن والبصمة المقطوعة حصراً؛ بلا أي بيانات
 * مستأجر حساسة ولا tenantId (حدود البيانات العامة في verify-model).
 * الحالات: تحميل / غير موجود / تعذر الوصول (متميزة عن غير الموجود —
 * فشل الشبكة لا يعني عدم وجود سجل) / قرار موثق. الاتجاه من كوكي اللغة.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { ApiError, fetchPublicVerification } from "@/lib/api-client";
import { parsePublicVerification, verificationFacts, type PublicVerification } from "@/lib/verify-model";
import { t, useLocale } from "@/lib/i18n";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { SkeletonLine } from "@/components/ui/Skeleton";
import { Button } from "@/components/ui/Button";

type VerifyState = "loading" | "ready" | "missing" | "unreachable";

/** زر نسخ مدمج للقيم التقنية — ينسخ القيمة الكاملة بلا تغيير المعروض */
function CopyButton(props: { readonly value: string; readonly locale: "ar" | "en" }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
      style={{ minHeight: 26, padding: "2px 8px", fontSize: "var(--text--2)" }}
      onClick={() => {
        void navigator.clipboard.writeText(props.value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }).catch(() => { /* الحجب لا يعرض خطأ */ });
      }}
      aria-label={`${copied ? t("common.copied", props.locale) : t("common.copy", props.locale)}: ${props.value}`}
    >
      {copied ? t("common.copied", props.locale) : t("common.copy", props.locale)}
    </button>
  );
}

export default function VerifyPage({ params }: { params: Promise<{ verificationId: string }> }) {
  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [result, setResult] = useState<PublicVerification | null>(null);
  const [state, setState] = useState<VerifyState>("loading");
  const [attempt, setAttempt] = useState(0);
  const { locale } = useLocale();

  useEffect(() => {
    void params.then(({ verificationId: id }) => {
      // مدخل معطّل (رموز % يتيمة) لا يُسقط الصفحة — يُعامل كغير موجود بأمان
      try {
        setVerificationId(decodeURIComponent(id));
      } catch {
        setVerificationId(id);
      }
    });
  }, [params]);

  // إعادة المحاولة ترفع attempt فيُعاد النداء — لا سحر في setVerificationId
  useEffect(() => {
    if (verificationId === null) return;
    let cancelled = false;
    setState("loading");
    fetchPublicVerification(verificationId)
      .then((raw) => {
        if (cancelled) return;
        const parsed = parsePublicVerification(raw);
        setResult(parsed);
        setState(parsed === null ? "missing" : "ready");
      })
      .catch((cause) => {
        if (cancelled) return;
        // 404 فقط = لا سجل (رسالة موحدة مانعة للتعداد — لا تمييز بين
        // «غير موجود» و«صيغة غير صالحة»). بقية الإخفاقات (شبكة/5xx/مهلة)
        // = خدمة غير متاحة ولا يُصدر حكم على وجود السجل إطلاقاً.
        const isNotFound =
          cause instanceof ApiError && (cause.status === 404 || cause.code === "NOT_FOUND");
        setState(isNotFound ? "missing" : "unreachable");
      });
    return () => {
      cancelled = true;
    };
  }, [verificationId, attempt]);

  return (
    <div className="verify-wrap">
      <div className="verify-hero">
        <h1 style={{ fontSize: "var(--text-2)", fontWeight: 800 }}>{t("verify.title", locale)}</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text--1)", marginTop: 8 }}>
          {t("verify.subtitle", locale)}
        </p>
      </div>

      {state === "loading" && (
        <section className="card" aria-busy="true">
          <SkeletonLine width="40%" height={18} />
          <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
            <SkeletonLine height={12} />
            <SkeletonLine width="85%" height={12} />
            <SkeletonLine width="65%" height={12} />
          </div>
        </section>
      )}

      {state === "missing" && (
        <section className="card">
          <div className="empty">
            <div className="icon" aria-hidden="true">◌</div>
            <div className="title">{t("verify.missingTitle", locale)}</div>
            <div className="hint">
              {t("verify.missingHint", locale)}
            </div>
          </div>
        </section>
      )}

      {/* فشل الوصول ≠ سجل غير موجود: أيقونة ولون حد وCTA مختلفة — لا oracle */}
      {state === "unreachable" && (
        <section className="card" role="alert" style={{ borderColor: "rgba(251, 191, 36, 0.55)" }} aria-busy="false">
          <div className="empty">
            <div className="icon" aria-hidden="true" style={{ color: "var(--amber)" }}>⚠</div>
            <div className="title">{t("verify.unreachableTitle", locale)}</div>
            <div className="hint">{t("verify.unreachableHint", locale)}</div>
            <div style={{ marginTop: 12 }}>
              <Button variant="ghost" onClick={() => setAttempt((value) => value + 1)}>{t("common.retry", locale)}</Button>
            </div>
          </div>
        </section>
      )}

      {state === "ready" && result !== null && (
        <>
          <section className="card fade-up">
            <div className="cert-panel" style={{ justifyContent: "center", marginBottom: 8 }}>
              <ScoreRing score={result.finalScore} granted={result.granted && !result.revoked} />
            </div>
            {/* هرمية القرار — الإبطال أولاً ثم فحوص التوقيع
                (انتهاء/تلاعب) ثم قرار المنح/الرفض المخزن. كل حالة بنصّها
                المترجم ولونها — لا يُعرض "ممنوحة" لشهادة ملغاة أو منتهية. */}
            {result.revoked ? (
              <div className="verify-verdict verify-verdict-revoked" role="alert">
                <strong>{t("verify.revokedTitle", locale)}</strong>
                <p>{t("verify.revokedHint", locale)}</p>
              </div>
            ) : result.signature?.present === true && result.signature.valid === false && result.signature.reason === "expired" ? (
              <div className="verify-verdict verify-verdict-expired" role="alert">
                <strong>{t("verify.expiredTitle", locale)}</strong>
                <p>{t("verify.expiredHint", locale)}</p>
              </div>
            ) : result.signature?.present === true && result.signature.valid === false ? (
              <div className="verify-verdict verify-verdict-revoked" role="alert">
                <strong>{t("verify.invalidSignatureTitle", locale)}</strong>
                <p>{t("verify.invalidSignatureHint", locale)}</p>
              </div>
            ) : (
              <p
                style={{
                  textAlign: "center",
                  fontWeight: 800,
                  fontSize: "var(--text-1)",
                  color: result.granted ? "#4ade80" : "var(--red)",
                }}
              >
                {result.granted ? t("verify.granted", locale) : t("verify.denied", locale)}
              </p>
            )}
            <ul className="verify-facts">
              {verificationFacts(result, locale).map((row) => (
                <li key={row.key}>
                  <span className="k">{row.key}</span>
                  {row.mono === true ? (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <span className="mono"><bdi>{row.value}</bdi></span>
                      {/* نسخ القيمة الكاملة للمعرفات والبصمات — العرض المقتطع يبقى كما هو */}
                      <CopyButton value={row.fullValue ?? row.value} locale={locale} />
                    </span>
                  ) : (
                    <span>{row.value}</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
          <section className="card" style={{ fontSize: "var(--text--1)", color: "var(--muted)" }}>
            {t("verify.hashNote", locale)}
          </section>
        </>
      )}

      <div style={{ textAlign: "center", marginTop: 20 }}>
        <Link href="/" className="link" style={{ fontSize: "var(--text--1)" }}>
          {t("verify.backHome", locale)}
        </Link>
      </div>

      {/* إخلاء المسؤولية الملزم: يظهر في كل الحالات دائماً
          (تحميل/غير موجود/تعذر الوصول/قرار موثق) ولا يغيب أبداً */}
      <section className="verify-disclaimer" aria-live="polite">
        {t("verify.disclaimer", locale)}
      </section>
    </div>
  );
}
