/**
 * تجميع القواميس ودالة الترجمة — نقطة الاستيراد الوحيدة للقيم.
 *
 * كيف: DICT من القاموسين، وt() يستبدل {{var}} بعد اختيار اللغة؛
 * غياب المتغيرات يعيد النص الخام. لا منطق آخر هنا.
 */

import { ar, type UiKey } from "./ar";
import { en } from "./en";
import type { Locale } from "../locale-shared";

export type { UiKey };

const DICT: Record<Locale, Readonly<Record<UiKey, string>>> = { ar, en };

/** يترجم مفتاحاً إلى نص اللغة المطلوبة مع استبدال متغيرات {{name}} */
export function t(
  key: UiKey,
  locale: Locale,
  vars?: Readonly<Record<string, string | number>>,
): string {
  const raw = DICT[locale][key];
  if (vars === undefined) return raw;
  let out: string = raw;
  for (const [name, value] of Object.entries(vars)) {
    out = out.split(`{{${name}}}`).join(String(value));
  }
  return out;
}

/** لغات الواجهة المسموحة — ترتيبها ترتيب العرض في مبدّل اللغة */
export const LOCALES: readonly Locale[] = ["ar", "en"];
