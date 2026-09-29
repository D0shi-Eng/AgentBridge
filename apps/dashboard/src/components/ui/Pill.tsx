"use client";

/** شارة حالة موحدة — تُرجِم كل حالات التشغيل والمراحل حسب لغة الواجهة */

import { t, useLocale } from "@/lib/i18n";
import type { Locale } from "@/lib/locale-shared";

export type PillStatus =
  | "running"
  | "completed"
  | "failed"
  | "needs_human"
  | "suspended"
  | string;

export interface PillMeta {
  readonly label: string;
  readonly tone: string;
}

/** خريطة الحالات — نقية لتُختبر وتُعاد في أي عرض؛ اللون داعم لا وحيد */
export function statusMeta(status: string, locale: Locale): PillMeta {
  switch (status) {
    case "running":
      return { label: t("status.running", locale), tone: "running" };
    case "completed":
      return { label: t("status.completed", locale), tone: "completed" };
    case "failed":
      return { label: t("status.failed", locale), tone: "failed" };
    case "needs_human":
      return { label: t("status.needs_human", locale), tone: "needs_human" };
    case "suspended":
      return { label: t("status.suspended", locale), tone: "suspended" };
    case "pending":
      return { label: t("status.pending", locale), tone: "neutral" };
    case "needs_repair":
      // الإصلاح الجاري عملٌ حي لا فشل نهائي — صياغة دقيقة لا «فشل»
      return { label: t("status.needs_repair", locale), tone: "suspended" };
    case "not_granted":
      // قرار شهادة سالب ≠ فشل تشغيل — نبرة تحذير مستقلة
      return { label: t("status.not_granted", locale), tone: "warning" };
    default:
      return { label: status, tone: "neutral" };
  }
}

export function Pill({ status }: { status: string }) {
  const { locale } = useLocale();
  const meta = statusMeta(status, locale);
  return <span className={`pill ${meta.tone}`}>{meta.label}</span>;
}
