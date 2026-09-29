"use client";

/**
 * عرض معرّف تقني — بديل النص الخام الغامض (معرّف تشغيل/معرّف تحقق/بصمة).
 *
 * ماهيته: خلية نص تقني مقتطع العرض مع زر نسخ يتيح المعرف الكامل عند الحاجة.
 * وظيفتها: قراءة مريحة بلا فقد المعنى — القيمة الكاملة في التلميح والنسخ
 * والحالة الاشتراكية، فلا يتغير معنى البيانات ولا يُختلق وصف لها.
 * كيف: مقتطع عرض ثابت (أول 12 حرفاً + …) باتجاه LTR محصور، والنسخ عبر
 * clipboard API مع إرجاع فوري للحالة «نُسخ» — بلا مكتبات خارجية.
 * المعرّفات القصيرة (أقصر من المقتطع) تُعرض كاملة بلا زر نسخ زائد.
 */

import { useEffect, useRef, useState } from "react";
import { t, useLocale } from "@/lib/i18n";

const DISPLAY_PREFIX = 12;

export function TechId(props: { readonly value: string; readonly label?: string }) {
  const { locale } = useLocale();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const short = props.value.length <= DISPLAY_PREFIX;
  const shown = short ? props.value : `${props.value.slice(0, DISPLAY_PREFIX)}…`;

  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch { /* الحجب (إذن مرفوض) يبقي الزر كما هو — لا توست ولا خطأ ظاهر */ }
  }

  return (
    <span className="tech-id" style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%" }}>
      <span className="mono" title={props.value} aria-label={props.label}><bdi>{shown}</bdi></span>
      {short ? null : (
        <button
          type="button"
          className="btn ghost sm"
          style={{ minHeight: 28, padding: "2px 8px", fontSize: "var(--text--2)" }}
          onClick={() => void copy()}
          aria-label={`${copied ? t("common.copied", locale) : t("common.copy", locale)}: ${props.label ?? props.value}`}
          title={props.value}
        >
          {copied ? t("common.copied", locale) : t("common.copy", locale)}
        </button>
      )}
    </span>
  );
}
