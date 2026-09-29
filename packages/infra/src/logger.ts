/**
 * السجلات المهيكلة — خيارات مسجل Fastify المدمج (pino) دون مكتبة جديدة
 * (قرار ADR: لا pino صريح ولا winston)، مع مرشح تحوير يمنع أي مفتاح/
 * توكن/كلمة مرور من الوصول إلى مخرجات السجل، ودالة redactText لتنقية
 * النصوص المستمدة من المستخدم قبل دخولها أي سجل أو سجل تدقيق (security.md §1).
 */

/** القيمة البديلة الموحدة للقيم المحجوبة */
export const REDACTED = "[محجوب]";

/** مسارات pino-redact — تُحجوب قيمتها في كل سجل مهيكل */
export const REDACT_PATHS: readonly string[] = [
  "req.headers.authorization",
  "req.headers.cookie",
  // req.url يحمل code/state في callback وPKCE verifier في start
  "req.url",
  "req.originalUrl",
  "*.password",
  "*.passwd",
  "*.token",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.encryptionKey",
];

export interface FastifyLoggerOptions {
  readonly level: string;
  readonly redact: { readonly paths: string[]; readonly censor: string };
}

/** خيارات جاهزة تمرر إلى fastify({ logger }) — مستوى السجل من config */
export function buildLoggerOptions(level: string): FastifyLoggerOptions {
  return { level, redact: { paths: [...REDACT_PATHS], censor: REDACTED } };
}

/** أنماط الأسرار في نص حر: مفاتيح تشبه sk-… وتعيينات password/token/… */
const SECRET_LIKE_KEY = /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}\b/gu;
const SECRET_ASSIGNMENT =
  /\b(password|passwd|pwd|token|secret|api[-_]?key|authorization|encryption[-_]?key)\b(["']?\s*[:=]\s*)(["']?)\S+/giu;

/** ينقي نصاً حرّاً من أنماط الأسرار — يُستخدم قبل أي تسجيل لمحتوى مستخدم */
export function redactText(text: string): string {
  return text.replace(SECRET_ASSIGNMENT, (_match, field: string, separator: string, quote: string) => {
    return `${field}${separator}${quote}${REDACTED}`;
  }).replace(SECRET_LIKE_KEY, REDACTED);
}
