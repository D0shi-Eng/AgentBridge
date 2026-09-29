/**
 * حرس الحقن والأنماط الخطِرة — قوائم الأنماط الأمنية والدوال الماسحة النقية.
 *
 * كل فحص هنا حتمي 100%: regex على نص الملفات المولدة، بلا أي نداء نموذج.
 * القوائم مستمدة من docs/security.md §5 (سلامة الكود المولد) وقائمة
 * أنماط حقن التعليمات في §6، وهي مرجع موحد تستخدمه الفحوص الساكنة والحية.
 */

/** إصابة نمط واحدة داخل ملف: رقم السطر + مقتطف للسياق */
export interface PatternHit {
  /** مسار الملف النسبي داخل الـartifact */
  readonly file: string;
  /** رقم السطر يبدأ من 1 */
  readonly line: number;
  /** مقتطف مقصوص من السطر للتوثيق */
  readonly excerpt: string;
}

/** أنماط تنفيذ كود ديناميكي — أخطر العائلات (حرجة) */
export const CODE_EXEC_PATTERNS: readonly RegExp[] = [
  /\beval\s*\(/,
  /\bnew\s+Function\s*\(/,
];

/** أنماط وصول لنظام الملفات أو الصدفة — الخادم المولد لا يحتاجها إطلاقاً */
export const SHELL_FS_PATTERNS: readonly RegExp[] = [
  /child_process/,
  /\bnode:fs\b/,
  /\bfrom\s+["']fs["']/,
  /\bfs\/promises\b/,
  /\breadFileSync\b/,
  /\bwriteFileSync\b/,
  /\bexecSync\b/,
  /\bspawn(?:Sync)?\s*\(/,
];

/** أنماط شبكة خام خارج القناة الوحيدة المرخصة (callUpstream عبر fetch) */
export const RAW_NETWORK_PATTERNS: readonly RegExp[] = [
  /\bnode:http2?\b/,
  /\bnode:https\b/,
  /\bnode:net\b/,
  /\bnode:tls\b/,
  /\bfrom\s+["']https?\b/,
  /\bundici\b/,
];

/** الاستيراد الديناميكي ممنوع في المولَّدات (وثيقة security.md §5) */
export const DYNAMIC_IMPORT_PATTERN: RegExp = /\bimport\s*\(/;

/** أنماط أسرار مضمّنة حرفياً في الكود أو الإعداد */
export const SECRET_PATTERNS: readonly RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\bghp_[A-Za-z0-9]{16,}/,
  /\bAKIA[0-9A-Z]{12,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(?:password|passwd|secret|api[_-]?key|auth[_-]?token)\s*[:=]\s*["'][^"']{6,}["']/i,
];

/** أنماط حقن تعليمات في النصوص الموجهة للوكلاء (وثيقة security.md §6) */
export const INJECTION_PATTERNS: readonly RegExp[] = [
  /ignore\s+(?:all\s+)?(?:previous|prior|above)/i,
  /disregard\s+(?:all\s+)?(?:previous|prior|above)/i,
  /system\s*prompt/i,
  /reveal\s+(?:your\s+)?(?:instructions|prompt|system)/i,
  /you\s+are\s+now\s+(?:a|an|the)/i,
  /developer\s+mode/i,
  /\bjailbreak\b/i,
  /\bexfiltrate\b/i,
  /<\/?system>/i,
  /\bBEGIN\s+(?:SYSTEM|INSTRUCTIONS)\b/i,
];

/** المفاتيح الوحيدة المسموح للخادم المولد قراءتها من البيئة */
export const ALLOWED_ENV_KEYS: ReadonlySet<string> = new Set([
  "UPSTREAM_BASE_URL",
  "UPSTREAM_API_KEY",
]);

/** يستخرج كل مفاتيح البيئة المقروءة بأي شكلين: process.env.X أو env["X"] */
export function collectEnvKeys(source: string): readonly string[] {
  const keys = new Set<string>();
  for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
    keys.add(match[1] ?? "");
  }
  for (const match of source.matchAll(/\benv\[["']([A-Z0-9_]+)["']\]/g)) {
    keys.add(match[1] ?? "");
  }
  keys.delete("");
  return [...keys];
}

/** يمسح نصاً واحداً بقائمة أنماط ويعيد المواضع مع أرقام الأسطر */
export function scanContents(
  file: string,
  contents: string,
  patterns: readonly RegExp[],
): readonly PatternHit[] {
  const hits: PatternHit[] = [];
  const lines = contents.split("\n");
  for (const [index, line] of lines.entries()) {
    for (const pattern of patterns) {
      if (pattern.test(line)) {
        hits.push({
          file,
          line: index + 1,
          excerpt: line.trim().slice(0, 120),
        });
        break; // إصابة واحدة لكل سطر تكفي — لا تضخيم للنتائج
      }
    }
  }
  return hits;
}
