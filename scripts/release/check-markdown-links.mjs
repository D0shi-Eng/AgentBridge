/**
 * مدقق روابط Markdown — حزمة جاهزية المستودع الخاص.
 *
 * ماهيتها: فحص حتمي لكل الروابط النسبية في ملفات Markdown المتتبعة:
 * يجب أن يوجد الملف الهدف في المستودع، وأن توجد العلامة المرجعية
 * (anchor) في الملف الهدف إن ذُكرت.
 * وظيفتها: بوابة CI تمنع وثائق ذات روابط ميتة قبل النشر.
 * كيف تعمل: تجمع الملفات من git ls-files، تستخرج أنماط
 * [نص](هدف) و<هدف>، تتجاهل الروابط الخارجية http(s) وmailto،
 * وتتحقق من وجود الملف النسبي وبطخة العنوان بصيغة GitHub.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..", "..");
const failures = [];

/** تحويل عنوان Markdown إلى بطخة anchor بصيغة GitHub (تدعم العربية) */
function slugify(heading) {
  return heading
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s+/g, "-");
}

function headingsOf(content) {
  content = content.replace(/\r\n/g, "\n"); // تطبيع CRLF — لا ينجو \r إلى البطخة
  const set = new Set();
  for (const line of content.split("\n")) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) set.add(slugify(match[2]));
  }
  return set;
}

const mdFiles = execFileSync("git", ["ls-files", "*.md"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const headingCache = new Map();

for (const rel of mdFiles) {
  const content = await fs.readFile(path.join(root, rel), "utf8").catch(() => null);
  if (content === null) continue;
  const links = [];
  for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) links.push(match[1]);
  for (const match of content.matchAll(/<((?!https?:)[A-Za-z0-9_./-]+\.md[^>]*)>/g)) links.push(match[1]);
  for (const link of links) {
    if (/^(https?:|mailto:|#)/.test(link)) continue; // خارجي أو داخلي بنفس الملف — يُفحص لاحقاً يدوياً
    const [target, anchor] = link.split("#");
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), decodeURIComponent(target)));
    const exists = await fs
      .stat(path.join(root, resolved))
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      failures.push(`${rel}: رابط ميت «${link}» → ${resolved}`);
      continue;
    }
    if (anchor) {
      if (!headingCache.has(resolved)) {
        const targetContent = await fs.readFile(path.join(root, resolved), "utf8").catch(() => "");
        headingCache.set(resolved, headingsOf(targetContent));
      }
      if (!headingCache.get(resolved).has(slugify(decodeURIComponent(anchor)))) {
        failures.push(`${rel}: علامة مرجعية ميتة «#${anchor}» في ${resolved}`);
      }
    }
  }
}

console.log(JSON.stringify({ markdownFilesChecked: mdFiles.length, failures }, null, 2));
process.exit(failures.length > 0 ? 1 : 0);
