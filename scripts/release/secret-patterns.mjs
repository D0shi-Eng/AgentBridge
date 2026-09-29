/**
 * أنماط كشف الأسرار والتسريب — حزمة جاهزية المستودع الخاص.
 *
 * ماهيتها: قائمة أنماط حتمية (regex) لكشف مواد الأسرار ومسارات الجهاز
 * والبيانات الشخصية داخل الملفات النصية، مع دوال تنقية وحد أدنى للضجيج.
 * وظيفتها: تُستهلك من secret-scan.mjs لفحص شجرة العمل وسجل Git كلاهما.
 * كيف تعمل: كل نمط يحمل معرفاً ودرجة خطورة ونمط استثناء اختيارياً؛
 * الدالة scanLine ترجع الإصابات لسطر واحد دون أن تطبع أي قيمة سرية أبداً.
 */

import { createHash } from "node:crypto";

/** الأنماط الرئيسية — لا تطبع قيمة المطابقة في أي تقارير (منزوعة القيم حصراً) */
export const SECRET_PATTERNS = [
  { id: "private-key-block", re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY(?: BLOCK)?-----/, severity: "critical" },
  { id: "certificate-block", re: /-----BEGIN CERTIFICATE-----/, severity: "critical" },
  { id: "agentbridge-api-key", re: /\bab_[A-Za-z0-9_-]{12,}\b/, severity: "critical" },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/, severity: "critical" },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/, severity: "critical" },
  { id: "openai-key", re: /\bsk-[A-Za-z0-9]{20,}\b/, severity: "critical" },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{30,}\b/, severity: "critical" },
  { id: "github-fine-grained-token", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, severity: "critical" },
  { id: "slack-token", re: /\bxox[bpars]-[A-Za-z0-9-]{10,}\b/, severity: "critical" },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/, severity: "critical" },
  { id: "jwt-serialized", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/, severity: "high" },
  { id: "database-dsn", re: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqps?|mssql):\/\/[^\s:@/]+:[^\s:@/]+@/, severity: "critical" },
  {
    id: "assigned-secret",
    re: /\b(?:ENCRYPTION_KEY|API_KEY|APIKEY|CLIENT_SECRET|PRIVATE_KEY|PASSWORD|PASSWD|SECRET|TOKEN|DB_PASSWORD)\s*[=:]\s*["']?[A-Za-z0-9+/=]{20,}/,
    severity: "high",
    excludeRe: /\$\{|\{\{|\(\)|process\.env|config\.|placeholder|changeme|example|xxxxx|<[^>]*>|\btest\b|\bfake\b/i,
  },
  {
    id: "password-literal",
    re: /\b(?:password|passwd|pwd)\s*[=:]\s*["'][^"'\s]{8,}["']/i,
    severity: "high",
    excludeRe: /\$\{|\{\{|process\.env|placeholder|changeme|example|dummy|xxxxx|<[^>]*>|\btest\b|\bfake\b|\bpassword\b\s*[:=]\s*["']password/i,
  },
  { id: "bearer-literal", re: /\bBearer\s+[A-Za-z0-9_\-.=+/]{30,}\b/, severity: "high", excludeRe: /<[^>]*>|\{\{|\$\{/ },
  { id: "windows-profile-path", re: /(?:[C-Z]:\\+Users\\+[A-Za-z0-9_-]+|\/Users\/[A-Za-z0-9_-]+)\b/, severity: "high" },
  { id: "owner-username", re: /\bD0shi\b(?!-Eng)/, severity: "high" }, // اسم مستخدم الويندوز المحلي فقط — اسم الحساب العام D0shi-Eng في روابط المستودع ليس تسريباً
  { id: "drive-letter-path", re: /\b[CD]:\\+[A-Za-z0-9_-]+\\+[A-Za-z0-9_-]+/, severity: "medium" },
  { id: "private-ip", re: /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/, severity: "medium" },
];

/**
 * كشف بالاعتلاج (entropy): وسم طويل شبيه base64 قد يكون سراً.
 * نستثني السلاسل السداسية (بصمات/هاشات)، والأرقام الخالصة، والكلمات
 * الدالة على الاصطناعية، لتقليص الضجيج دون إخفاء أي نمط صريح.
 */
const ENTROPY_TOKEN = /(?<![A-Za-z0-9+/=_-])[A-Za-z0-9+/=_-]{30,}(?![A-Za-z0-9+/=_-])/g;
const ENTROPY_FLOOR = 4.3;
const SYNTHETIC_HINT = /(?:test|fake|example|sample|placeholder|redacted|dummy|spec|fixture|template)/i;
const HASH_PREFIX = /^(?:sha1|sha256|sha384|sha512|md5|blake2b)-/i;

function shannonBits(text) {
  const counts = new Map();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / text.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/**
 * مرشحات الإيجابيات الكاذبة البنيوية — كلها أشكال معروفة لا تكون أسراراً
 * بطبيعتها: بصمات سلامة مسبوقة بخوارزمية، طوابع زمنية ثقيلة الأرقام،
 * ومسارات معرفات مركبة بشرائح كثيرة.
 */
function structuralFalsePositive(token) {
  if (HASH_PREFIX.test(token)) return true; // بصمة سلامة بحقل صريح (integrity/ digest)
  const digits = (token.match(/\d/g) ?? []).length;
  if (digits / token.length >= 0.5) return true; // طوابع زمنية/إصدارات
  const slashes = (token.match(/\//g) ?? []).length;
  if (slashes >= 3) return true; // مسار معرفات (components/ui/...) لا رمز سري
  // إسناد متغير بيئة بمفتاح SCREAMING_SNAKE وقيمة معرفية بسيطة = سطر إعداد
  // لا رمز؛ القيم السرية الفعلية تلتقطها أنماط assigned-secret وdatabase-dsn
  if (/^[A-Z][A-Z0-9_]*=[a-z0-9._-]+$/.test(token)) return true;
  return false;
}

/** يعيد إصابات الاعتلاج لسطر واحد — medium كحد أقصى لأنها مرشحة لا مؤكدة */
export function entropyFindings(line) {
  const out = [];
  for (const match of line.matchAll(ENTROPY_TOKEN)) {
    const token = match[0];
    if (/^[0-9a-fA-F]+$/.test(token)) continue; // سداسي خالص = بصمة/هاش لا سر
    if (/^\d+$/.test(token)) continue;
    if (SYNTHETIC_HINT.test(token)) continue;
    if (structuralFalsePositive(token)) continue;
    if (shannonBits(token) < ENTROPY_FLOOR) continue;
    out.push({ pattern: "high-entropy-token", severity: "medium", length: token.length });
  }
  return out;
}

/**
 * فحص سطر واحد ضد كل الأنماط — يعيد قائمة إصابات منزوعة القيم:
 * (المعرف، الخطورة، طول المطابقة) فقط؛ لا تُعاد قيمة السر إطلاقاً.
 */
export function scanLine(line) {
  const out = [];
  for (const pattern of SECRET_PATTERNS) {
    if (!pattern.re.test(line)) continue;
    if (pattern.excludeRe && pattern.excludeRe.test(line)) continue;
    out.push({ pattern: pattern.id, severity: pattern.severity, length: (line.match(pattern.re) ?? [""])[0].length });
  }
  return out;
}

/** بصمة آمنة قصيرة للإصابة — تُبنى من مسار+سطر+نمط بلا أي محتوى */
export function findingFingerprint(path_, line, patternId) {
  return createShortHash(`${path_}:${line}:${patternId}`);
}

function createShortHash(text) {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}
