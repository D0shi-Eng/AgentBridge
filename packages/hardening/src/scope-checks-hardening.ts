/**
 * فحوص التصلب الإضافية — النصف الثاني من فاحص الحدود.
 *
 * ماهية الكود: دوال نقية على نص الملفات تفحص:
 *   1. HB-11: JSON.parse بلا حد حجم في الكود المولد (medium).
 *   2. HB-12: jwksUrl عبر http مرفوض — يجب https فقط (medium).
 *   3. تعقيم رسائل الفشل عبر describeUpstreamFailure بلا تسريب جسم الاستجابة.
 * كيف يعمل: مطابقة نصية حتمية — لا قراءة قرص ولا شبكة.
 */

import type { StructuralCheck } from "./scope-checks.js";

/**
 * HB-11: JSON.parse بلا حد حجم أو بغياب النمط كله فشل.
 * «الملف الصحيح»: JSON.parse في الخادم المولد يعيش في عميل upstream لا
 * tools.ts بالضرورة — لذا يمسح الفحص كل ملفات src: غياب الاستخدام كلياً
 * فشل (مخالف لعقد المولد)، وكل ملف يستخدمه يجب أن يحمل الحارس بنفسه
 * (سقف البايتات/413) — لا حماية في ملف وفحص في آخر.
 */
export function checkJsonParseProtection(sources: ReadonlyMap<string, string>): StructuralCheck {
  const usingFiles: string[] = [];
  const unguarded: string[] = [];
  for (const [file, source] of sources) {
    if (!source.includes("JSON.parse")) continue;
    usingFiles.push(file);
    // الحارس: حد حجم صريح أو رفض 413 أو فحص payloadSize — في الملف نفسه
    const hasGuard = source.includes("524288") || source.includes("413") ||
      source.includes("payloadSize") || source.includes("payload_too_large");
    if (!hasGuard) unguarded.push(file);
  }
  if (usingFiles.length === 0) {
    return {
      passed: false,
      location: "src/*:JSON.parse",
      detail: "لا ملف مصدر يستخدم JSON.parse — مخالف لعقد المولد؛ الفحص لن يمر فراغاً على ملف خاطئ",
    };
  }
  if (unguarded.length > 0) {
    return {
      passed: false,
      location: `${unguarded[0]}:JSON.parse`,
      detail: `${unguarded.length} ملفاً يستخدم JSON.parse بلا حد حجم في نفسه — استنزاف ذاكرة محتمل بحمولة ضخمة`,
    };
  }
  return { passed: true };
}

/** خيارات فحص JWKS — الوعي بعقد البيئة يمنع النجاح الفراغي */
export interface JwksCheckOptions {
  /** هل يعلن manifest env مطلوباً يخص مفاتيح الهوية؟ حضوره يجعل غياب jwks فشلاً */
  readonly required: boolean;
}

/**
 * HB-12: jwksUrl عبر https فقط.
 * الفحص يتوسع لكل ملفات src (لا tools.ts وحده — «الملف الصحيح»)،
 * وغياب أي ذكر لjwks يفشل إذا كان عقد البيئة يتطلبه، ويمر موثقاً
 * بغيابه فقط إذا لم يتطلبه manifest.
 */
export function checkJwksUrlHttps(sources: ReadonlyMap<string, string>, options: JwksCheckOptions = { required: false }): StructuralCheck {
  let jwksSeen = false;
  for (const [file, source] of sources) {
    if (!source.toLowerCase().includes("jwks")) continue;
    jwksSeen = true;
    // صرامة مقصودة: أي URL نصي عبر http في ملف يتعامل مع jwks = فشل —
    // الاستثناءات (تعليقات مثلاً) تُحل بتعديل المولد لا بتخفيف الفاحص
    const urlLiterals = [...source.matchAll(/https?:\/\/[^"'\s`)\]]+/giu)].map((match) => match[0]);
    const insecure = urlLiterals.find((url) => url.toLowerCase().startsWith("http://"));
    if (insecure !== undefined) {
      return {
        passed: false,
        location: `${file}:jwksUrl`,
        detail: `مرجع jwks في ملف يحوي URL غير مشفر (${insecure}) — مفاتيح الهوية عبر https فقط`,
      };
    }
  }
  if (!jwksSeen && options.required) {
    return {
      passed: false,
      location: "src/*:jwks",
      detail: "manifest يعلن متطلب env لمفاتيح الهوية والكود بلا أي تعامل jwks — ملف خاطئ أو مولد ناقص",
    };
  }
  return { passed: true };
}

/** يستخلص نوافذ مسارات الخطأ (isError) من tools.ts لفحص التعقيم */
export function extractErrorReturnWindows(source: string): readonly string[] {
  const windows: string[] = [];
  const marker = /return\s*\{\s*isError:\s*true/g;
  for (const match of source.matchAll(marker)) {
    const start = match.index ?? 0;
    const end = source.indexOf("};", start);
    windows.push(source.slice(start, end === -1 ? undefined : end + 2));
  }
  return windows;
}

/**
 * يفحص تعقيم رسائل الفشل: كل مسار خطأ يمر عبر describeUpstreamFailure
 * ولا يمرِّر جسم الاستجابة (result.body أو النص الخام) إلى المستهلك.
 * مسار رفض الحمولة الضخمة 413 يُعفى لأنه قبل أي نداء upstream.
 */
export function checkErrorSanitization(toolsSource: string): StructuralCheck {
  if (!toolsSource.includes("describeUpstreamFailure")) {
    return {
      passed: false,
      location: "src/tools.ts",
      detail: "مسار الخطأ المنظف describeUpstreamFailure غير مستخدم إطلاقاً",
    };
  }
  const windows = extractErrorReturnWindows(toolsSource);
  for (const [index, window] of windows.entries()) {
    // إعفاء مسار رفض الحمولة 413 — لا يمرر جسم upstream أصلاً
    if (window.includes("413")) continue;
    if (!window.includes("describeUpstreamFailure(")) {
      return {
        passed: false,
        location: `src/tools.ts#error[${index}]`,
        detail: "مسار خطأ لا يستخدم الوصف المنظف — قد يسرّب محتوى الاستجابة",
      };
    }
    if (/\.body|rawText|response\.text/.test(window)) {
      return {
        passed: false,
        location: `src/tools.ts#error[${index}]`,
        detail: "مسار خطأ يضمّ جسم الاستجابة في الرسالة — تسريب مباشر",
      };
    }
  }
  return { passed: true };
}
