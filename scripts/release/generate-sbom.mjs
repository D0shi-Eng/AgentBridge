/**
 * مولّد SBOM (CycloneDX 1.5) — حزمة جاهزية المستودع الخاص.
 *
 * ماهيتها: تبني قائمة حزم (SBOM) من pnpm-lock.yaml حصراً — تحليل حتمي
 * بلا شبكة — مع قراءة license كل حزمة من node_modules
 * المثبتة فعلاً عندما تتوفر.
 * وظيفتها: بوابة SBOM في CI، بلا أي أداة خارجية أو شبكة.
 * كيف تعمل: تفك سطور «'name@version:'» في قسم packages: من الملف المقفل
 * وتصدر مكونات CycloneDX مع purl؛ license مفقود يُسجل NOASSERTION ولا
 * يفشل البوابة (يُدقق التراخيص في بوابة مستقلة).
 *
 *   node generate-sbom.mjs <out.cdx.json>
 */

import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..", "..");
const outPath = resolve(process.argv[2] ?? "sbom.cdx.json");
const lockPath = join(root, "pnpm-lock.yaml");

/** تفكيك سطور الحزم من القفل: 'name@version:' مع تجاهل peer suffixes */
function parseLockPackages(lock) {
  const lines = lock.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === "packages:");
  const results = [];
  if (start < 0) return results;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line)) break; // نهاية قسم packages
    const match = /^ {2}'?([^:\s']+@[^:\s'()]+)'?:/.exec(line);
    if (!match) continue;
    const spec = match[1];
    const at = spec.lastIndexOf("@");
    if (at <= 0) continue;
    const name = spec.slice(0, at);
    const version = spec.slice(at + 1).replace(/\(.*\)$/, "");
    if (!name || !version) continue;
    results.push({ name, version });
  }
  return results;
}

/** قراءة license من الحزمة المثبتة فعلاً داخل متجر pnpm */
function installedLicense(name, version) {
  const flatName = name.replace(/@/gu, "").replace(/\//gu, "+");
  for (const dir of [
    join(root, "node_modules", ".pnpm", `${flatName}@${version}`, "node_modules", name),
    join(root, "node_modules", ".pnpm", `${name}@${version}`, "node_modules", name),
  ]) {
    const pkgPath = join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        return JSON.parse(readFileSync(pkgPath, "utf8")).license ?? "NOASSERTION";
      } catch {
        return "NOASSERTION";
      }
    }
  }
  return "NOASSERTION";
}

function purlOf(name, version) {
  const encoded = name.split("/").map(encodeURIComponent).join("%2F");
  return `pkg:npm/${encoded}@${version}`;
}

const lock = readFileSync(lockPath, "utf8");
const packages = parseLockPackages(lock);
const licensesNoAssertion = [];

const components = packages.map((pkg) => {
  const license = installedLicense(pkg.name, pkg.version);
  if (license === "NOASSERTION") licensesNoAssertion.push(`${pkg.name}@${pkg.version}`);
  const licenseEntry = license === "NOASSERTION" ? { license: { name: "NOASSERTION" } } : { license: { id: license } };
  return {
    type: "library",
    "bom-ref": purlOf(pkg.name, pkg.version),
    name: pkg.name,
    version: pkg.version,
    purl: purlOf(pkg.name, pkg.version),
    licenses: [licenseEntry],
  };
});

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: "application", name: "agentbridge", "bom-ref": "pkg:npm/agentbridge" },
    properties: [
      { name: "agentbridge:sbom:source", value: "pnpm-lock.yaml (offline deterministic parse)" },
      { name: "agentbridge:sbom:packages", value: String(components.length) },
    ],
  },
  components,
};

const { writeFileSync } = await import("node:fs");
writeFileSync(outPath, JSON.stringify(sbom, null, 2) + "\n", "utf8");
console.log(JSON.stringify({ out: outPath, packages: components.length, licensesNoAssertion: licensesNoAssertion.length }, null, 2));
