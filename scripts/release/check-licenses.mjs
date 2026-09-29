/**
 * مدقق التراخيص — حزمة جاهزية المستودع الخاص.
 *
 * ماهيتها: فحص حتمي أن كل حزم المونوريبو تحمل ترخيص Apache-2.0 وتبقى
 * خاصة (`private: true`) ومنعاً لنشر npm قبل جهوزية النشر المعتمدة.
 * وظيفتها: بوابة CI للتحقق من صحة الترخيص وملفات الإسناد.
 * كيف تعمل: تجد كل package.json عبر pnpm list ثم تفحص الحقول المطلوبة،
 * وتتحقق من وجود LICENSE وNOTICE وTHIRD_PARTY_NOTICES في الجذر.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "..", "..");
const failures = [];

// 1) كل حزم مساحات العمل: license=Apache-2.0 وprivate=true
const list = execFileSync("pnpm", ["-r", "list", "--json", "--depth", "-Infinity"], { cwd: root, encoding: "utf8", shell: true });
const workspaces = JSON.parse(list);
let checked = 0;
for (const workspace of workspaces) {
  const pkgPath = path.join(workspace.path, "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8"));
  checked++;
  if (pkg.license !== "Apache-2.0") failures.push(`${pkgPath}: license=${JSON.stringify(pkg.license)} والمطلوب Apache-2.0`);
  if (pkg.private !== true) failures.push(`${pkgPath}: private غير مضبوط true — حاجز نشر npm مفقود`);
}

// 2) ملفات الترخيص والإسناد في الجذر
for (const file of ["LICENSE", "NOTICE", "THIRD_PARTY_NOTICES.md"]) {
  try {
    const stat = await fs.stat(path.join(root, file));
    if (stat.size === 0) failures.push(`${file}: موجود لكنه فارغ`);
  } catch {
    failures.push(`${file}: مفقود من جذر المستودع`);
  }
}

console.log(JSON.stringify({ workspacesChecked: checked, failures }, null, 2));
process.exit(failures.length > 0 ? 1 : 0);
