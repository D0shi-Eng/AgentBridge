/**
 * كاشف حقن التعليمات — بوابة الحقيقة المبكرة لمرحلة الاستيعاب.
 *
 * الوظيفة: مسح كل القيم النصية في المواصفة بحثاً عن أنماط تحاول
 * التحكم بالوكلاء الذين سيقرأون هذه المواصفة لاحقاً (مثل وكلاء التصميم).
 * المواصفة مصدر بيانات وليست تعليمات — أي محاولة إعطاء أوامر عبرها تُرفض.
 *
 * كيف يعمل: تجوال عمق أولاً فوق المستند مع تتبع JsonPointer لكل قيمة نصية،
 * ومطابقة قائمة أنماط ثابتة حتمية — صفر ذكاء اصطناعي هنا.
 */

import type { AppError } from "@agentbridge/shared";
import { SpecErrors } from "./errors.js";

/** أنماط الحقن المعروفة — تُحدَّث بالتجربة وتُختبر دائماً */
const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|prompts?|rules)/i,
  /disregard\s+(all\s+)?(previous|prior|above|your)\s+(instructions|prompts?|rules)/i,
  /\b(you\s+are\s+now|from\s+now\s+on\s+you\s+are)\b/i,
  /reveal\s+(your\s+)?(system\s+)?(prompt|instructions)/i,
  /\bsystem\s+prompt\b/i,
  /exfiltrate|send\s+(all\s+)?(the\s+)?data\s+to\b/i,
  /<\/?script[\s>]/i,
];

/** حد العمق لمنع التجوال في هياكل شاذة العمق */
const MAX_DEPTH = 64;

/** نتيجة المسح: مؤشر أول إصابة أو لا شيء */
export type InjectionScanResult =
  | { readonly clean: true }
  | { readonly clean: false; readonly error: AppError };

/** هل النص يطابق أحد أنماط الحقن؟ */
function matchesInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * مسح متكرر لكامل المستند. يعيد خطأ أول إصابة بمؤشرها الدقيق،
 * أو نجاح نظيف إن لم يوجد شيء — الحتمية الكاملة.
 */
export function scanForInjection(
  node: unknown,
  pointer: string = "",
  depth: number = 0,
): InjectionScanResult {
  if (depth > MAX_DEPTH) return { clean: false, error: SpecErrors.invalidStructure(`عمق المستند يتجاوز ${MAX_DEPTH} مستوى عند ${pointer || "/"}`) };

  if (typeof node === "string") {
    return matchesInjection(node)
      ? { clean: false, error: SpecErrors.suspiciousContent(pointer || "/") }
      : { clean: true };
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      const result = scanForInjection(node[i], `${pointer}/${i}`, depth + 1);
      if (!result.clean) return result;
    }
    return { clean: true };
  }

  if (typeof node === "object" && node !== null) {
    const entries = Object.entries(node as Record<string, unknown>);
    // ترتيب ثابت حسب المفتاح لضمان نفس النتيجة في كل تشغيل (الحتمية)
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [key, value] of entries) {
      const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
      const result = scanForInjection(value, `${pointer}/${escaped}`, depth + 1);
      if (!result.clean) return result;
    }
  }

  return { clean: true };
}
