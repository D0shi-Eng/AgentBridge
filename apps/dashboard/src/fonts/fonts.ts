/**
 * الخطوط المحلية — هوية طباعية مفتوحة المصدر بلا أي جلب
 * خطوط وقت التشغيل (next/font/local يضمّنها في البناء ويولّد fallback مدمجًا).
 *
 * ماهيتها: تعريفان لخطّين مفتوحين تحت OFL-1.1 مع ملفات ترخيصهما بجانب ملفات
 * woff2 في هذا المجلد:
 *   - IBM Plex Sans Arabic (400/600/700) — نصوص الواجهة العربية.
 *   - Inter (400/600/700، المجموعة اللاتينية) — النصوص الإنجليزية.
 * كيف: يُصدَّر متغيرا CSS يوضعان على عنصر html في الجذر، وكومة الخطوط في
 * base.css تستهلكهما مع سقوط آمن إلى خطوط النظام. الترتيب يتقلب مع الاتجاه:
 * العربية أولًا في RTL، وInter أولًا في LTR (انظر base.css).
 */

import localFont from "next/font/local";

/** IBM Plex Sans Arabic — الأوزان الثلاثة المستخدمة في الواجهة */
export const plexSansArabic = localFont({
  src: [
    { path: "./IBMPlexSansArabic-Regular.woff2", weight: "400", style: "normal" },
    { path: "./IBMPlexSansArabic-SemiBold.woff2", weight: "600", style: "normal" },
    { path: "./IBMPlexSansArabic-Bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex-arabic",
  display: "swap",
});

/** Inter — المجموعة اللاتينية فقط (العربية تسقط إلى Plex عبر الكومة) */
export const interLatin = localFont({
  src: [
    { path: "./inter-latin-400-normal.woff2", weight: "400", style: "normal" },
    { path: "./inter-latin-600-normal.woff2", weight: "600", style: "normal" },
    { path: "./inter-latin-700-normal.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});
