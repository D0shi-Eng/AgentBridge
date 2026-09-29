"use client";

import { t, useLocale } from "@/lib/i18n";

/** حلقة الدرجة الموحدة — لونها من القرار لا من المتصل، ونص الحكم تحتها.
 * اللون داعم لا وحيد: نص الحكم (ممنوحة/مرفوضة) موجود دائماً بجانب الحلقة. */

/** نبرة الحلقة نقية لتُختبر: منح = أخضر الثقة، عدم منح = عنبري تحذيري
 * (رفض الشهادة ليس «فشل تشغيل» أحمر — تمييز القرارين) */
export function scoreRingColor(granted: boolean): string {
  return granted ? "#22c55e" : "#fbbf24";
}

export function ScoreRing(props: { score: number; granted: boolean; caption?: string }) {
  const { locale } = useLocale();
  const verdict = props.caption ?? t(props.granted ? "status.granted" : "status.denied", locale);
  return (
    <div
      className="ring"
      style={{ ["--p" as string]: String(props.score), ["--ring-c" as string]: scoreRingColor(props.granted) }}
      role="img"
      aria-label={`${props.score} / 100 — ${verdict}`}
    >
      <b>{props.score}</b>
      <span className="verdict">{verdict}</span>
    </div>
  );
}
