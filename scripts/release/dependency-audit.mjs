/**
 * مدقق الاعتماديات بقائمة سماحية موثقة — حزمة جاهزية المستودع الخاص.
 *
 * ماهيتها: يدير pnpm audit --prod بصيغة JSON ويفصل التحذيرات إلى
 * حاجبة ومقبولة بحسب قائمة سماحية معللة، مثل ماسح الأسرار تماماً.
 * وظيفتها: بوابة CI للتدقيق دون قبول صامت للثغرات غير الموثقة.
 * كيف تعمل: كل بند سماحية يحمل معرف التحذير (GHSA) والوحدة والسبب
 * والحالة؛ أي تحذير خارج القائمة = فشل مع طباعة معرفه (بلا أسرار).
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const allowlist = JSON.parse(await fs.readFile(path.join(import.meta.dirname, "dependency-audit-allowlist.json"), "utf8"));

let raw;
try {
  // pnpm audit يخرج برمز غير صفري عند وجود تحذيرات — stdout صالح حصراً
  raw = execFileSync("pnpm", ["audit", "--prod", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: true });
} catch (err) {
  raw = String(err.stdout ?? "");
}
if (!raw.trim().startsWith("{")) {
  console.error("تعذر الحصول على تقرير تدقيق JSON صالح");
  process.exit(2);
}
const report = JSON.parse(raw);
const advisories = Object.values(report.advisories ?? {});
const failures = [];
const accepted = [];

for (const adv of advisories) {
  const hit = allowlist.exceptions.find((e) => e.ghsa === adv.github_advisory_id || e.module === adv.module_name);
  const entry = { ghsa: adv.github_advisory_id, module: adv.module_name, severity: adv.severity, title: adv.title, paths: (adv.findings ?? []).map((f) => f.paths?.flat?.() ?? []).flat().slice(0, 3) };
  if (hit) accepted.push({ ...entry, justification: hit.justification, status: hit.status });
  else failures.push(entry);
}

console.log(JSON.stringify({ advisoriesTotal: advisories.length, accepted: accepted.length, failures }, null, 2));
process.exit(failures.length > 0 ? 1 : 0);
