/**
 * فاحص الموقع الثابت — بوابات صدق الموقع بلا أي نشر:
 * 1) كل ملفات الموقع الأساسية موجودة.
 * 2) كل الروابط النسبية داخل HTML تشير إلى ملفات موجودة فعلاً.
 * 3) لا سكربتات ولا نماذج إدخال ولا تتبع ولا إطارات ولا طلبات خارجية خطرة.
 * 4) سمتا lang وdir موجودتان على <html> في كل صفحة.
 * 5) لا أسرار مرشحة في مصدر الصفحات.
 * رمز الخروج 0 = سليم؛ 1 = أي مخالفة.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const problems = [];
const pages = ["index.html", "en/index.html", "404.html"];

for (const page of pages) {
  const p = join(HERE, page);
  if (!existsSync(p)) { problems.push(`ملف مفقود: ${page}`); continue; }
  const html = readFileSync(p, "utf8");

  if (!/<html[^>]*\slang="/.test(html)) problems.push(`${page}: سمة lang غائبة عن <html>`);
  if (!/<html[^>]*\sdir="/.test(html)) problems.push(`${page}: سمة dir غائبة عن <html>`);

  // لا سكربتات إطلاقًا (الموقع ثابت خالص بلا جافاسكربت)
  const scripts = html.match(/<script\b/gi) || [];
  if (scripts.length > 0) problems.push(`${page}: وُجد ${scripts.length} وسم <script> — الموقع بلا جافاسكربت`);

  // لا نماذج ولا إطارات ولا أدوات تتبع (نطاقات/استدعاءات لا كلمات نثر)
  for (const bad of ["<form", "<iframe", "googletagmanager", "google-analytics.com", "gtag(", "hotjar.com", "recaptcha/api", "cdn.jsdelivr.net", "unpkg.com"]) {
    if (html.toLowerCase().includes(bad)) problems.push(`${page}: كلمة ممنوعة: ${bad}`);
  }

  // التحقق من كل الروابط والمصادر النسبية
  const refs = [...html.matchAll(/(?:href|src)="([^"#]+)(?:#[^"]*)?"/g)].map((m) => m[1]);
  for (const ref of refs) {
    if (/^(https?:)?\/\//.test(ref) || ref.startsWith("mailto:")) continue; // روابط خارجية مسموحة كنص
    if (ref.startsWith("#")) continue;
    const target = resolve(dirname(p), ref.split("?")[0]);
    if (!existsSync(target)) problems.push(`${page}: مرجع مكسور: ${ref}`);
  }

  // لا أسرار مرشحة
  if (/(sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/.test(html)) {
    problems.push(`${page}: نمط سر مرشح في المصدر`);
  }
}

// قاعدة الوصول الأساسية: رابط تخطٍ في كل صفحة
for (const page of pages) {
  const p = join(HERE, page);
  if (!existsSync(p)) continue;
  if (!readFileSync(p, "utf8").includes('class="skip"')) problems.push(`${page}: رابط التخطي غائب`);
}

if (problems.length > 0) {
  console.error("WEBSITE_CHECK_FAIL");
  for (const x of problems) console.error(" - " + x);
  process.exit(1);
}
console.log("WEBSITE_CHECK_OK (3 pages, no scripts, no forms, no trackers, relative links resolve)");
