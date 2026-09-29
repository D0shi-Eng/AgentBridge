/**
 * مولّد بيان الإصدار العام — بصمات SHA-256 لكل الملفات المتتبعة.
 * يستثني نفسه حصراً؛ لا يحمل أي طابع زمني أو معرف تشغيل حتى يبقى
 * حتمياً بالكامل: الشجرة نفسها تعطي البايتات نفسها دائماً.
 * البصمات لبايتات كائنات Git الكانونية (git cat-file) لا بايتات القرص —
 * فتطابقها مستقل عن نظام التشغيل وإعدادات autocrlf.
 * الاستخدام: node scripts/release/generate-release-manifest.mjs
 * التحقق: git cat-file blob HEAD:<path> | sha256sum
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const SELF = "scripts/release/generate-release-manifest.mjs";
const OUT = "public-release-manifest.json";

const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, maxBuffer: 1 << 28 })
  .toString()
  .split("\0")
  .filter(Boolean)
  .filter((f) => f !== OUT && f !== SELF)
  .sort();

const cat = (rel) => execFileSync("git", ["cat-file", "blob", `HEAD:${rel}`], { cwd: root, maxBuffer: 1 << 28 });

const entries = files.map((rel) => {
  const buf = cat(rel);
  return { path: rel.replace(/\\/g, "/"), bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
});

const manifest = {
  manifest: "agentbridge-public-release/1.2",
  algorithm: "sha256-of-git-blob",
  fileCount: entries.length,
  selfExcluded: [OUT, SELF],
  note: "كل ملفات المستودع المتتبعة كما يسردها git ls-files؛ البصمة لبايتات كائن Git الكانونية (git cat-file blob HEAD:<path>) فلا تتأثر بـautocrlf — يستثنى هذا البيان ومولّده. التحقق: إجمالي المسارات المتتبعة = fileCount + 2",
  files: entries,
};

writeFileSync(join(root, OUT), JSON.stringify(manifest, null, 2) + "\n");
console.log(`MANIFEST_OK files=${entries.length}`);

