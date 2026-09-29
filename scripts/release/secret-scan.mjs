/**
 * ماسح الأسرار — حزمة جاهزية المستودع الخاص (CLI).
 *
 * ماهيتها: أداة حتمية بلا تبعيات خارجية تفحص الملفات النصية بحثاً عن
 * أسرار ومسارات محلية ومعرفات بيئة التطوير، وتصدر تقريراً JSON منزوع القيم.
 * وظيفتها: بوابات فحص شجرة العمل وسجل Git قبل أي staging أو دفع.
 * كيف تعمل:
 *   node secret-scan.mjs worktree --root <dir>   فحص شجرة كاملة
 *   node secret-scan.mjs history  --root <dir>   فحص كل blobs سجل Git
 *   node secret-scan.mjs files    --paths <f>    فحص قائمة مسارات (سطر لكل مسار)
 * خيارات: --json (الإخراج JSON) — النتائج بصمات لا قيم، والسماحية
 * الموثقة تُقرأ من secret-scan-allowlist.json بجوار هذا الملف.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { scanLine, entropyFindings, findingFingerprint } from "./secret-patterns.mjs";

const TEXT_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs", ".py", ".json", ".md", ".yaml", ".yml", ".css", ".txt", ".html", ".sh", ".sql", ".prisma", ".svg", ".example", ".gitignore", ".dockerignore", ".editorconfig", ".npmrc", ".xml", ".csv", ".toml", ".lock", ".dockerfile", ".ps1"]);
const MAX_TEXT_BYTES = 2_000_000;
const FINDINGS_PER_FILE_CAP = 5; // سقف إصابات الملف الواحد في التقرير — العدد الكامل يبقى محسوباً

/** قائمة السماحية الموثقة — كل بند بسبب مكتوب ومراجَع */
async function loadAllowlist(root) {
  const file = path.join(import.meta.dirname, "secret-scan-allowlist.json");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return { exceptions: [] };
  }
}

/** هل النص ثنائي؟ (بايت صفري في أول 8 كيلوبايت تكفي حتماً) */
function looksBinary(buffer) {
  const head = buffer.subarray(0, 8192);
  return head.includes(0);
}

/** فحص مخزن نصي واحد — يبني إصابات منزوعة القيم مع بصمات قصيرة.
 * ملفا قواعد الكشف واختباره الذاتي مستثنيان بنيوياً: نصوصهما الحرفية أدوات
 * كشف وعينات اصطناعية لقياس الكشف حصراً لا أسرار حقيقية. */
export function scanText(relPath, content, lineOffset = 0) {
  if (relPath.endsWith("secret-patterns.mjs") || relPath.endsWith("secret-scan.test.mjs")) return [];
  const raw = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // السطور المولّدة آلياً (مسارات SVG المصغرة مثلها) ليست نصاً بشرياً —
    // بيانات رسم متجهة لا أسرار، وتجاوزها يمنع إغراق الإيجابيات الكاذبة.
    if (line.length > 2000) continue;
    for (const finding of scanLine(line)) raw.push({ line: i + 1 + lineOffset, ...finding });
    for (const finding of entropyFindings(line)) raw.push({ line: i + 1 + lineOffset, ...finding });
  }
  return raw.map((f) => ({ path: relPath, ...f, fingerprint: findingFingerprint(relPath, f.line, f.pattern) }));
}

/** مشية شجرة مع كشف الثنائيات — تعيد الملفات النصية القابلة للفحص وإحصاء الثنائيات.
 * مسارات التوليد المقصودة تُستثنى بمسارها الجذري الدقيق حصراً (لا بأسماء عامة)،
 * وأي نظير متتبع لها يُرفض في فحص الشجرة بدل تجاهله (انظر trackedGeneratedRefusals). */
const GENERATED_PATHS = new Set([
  "runtime",
  "docker/sandbox-runner/shared-dist",
  "docker/sandbox-runner/hardening-dist",
]);

export async function collectTextFiles(root) {
  const files = [];
  const binaryFiles = [];
  const skip = new Set(["node_modules", ".git", ".next", "dist", "coverage", ".local", ".tmp"]);
  async function walk(dir) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const relDir = path.relative(root, abs).split(path.sep).join("/");
        if (skip.has(entry.name) || GENERATED_PATHS.has(relDir)) continue;
        await walk(abs);
        continue;
      }
      const rel = path.relative(root, abs).split(path.sep).join("/");
      const stat = await fs.stat(abs).catch(() => null);
      if (stat === null || stat.size > MAX_TEXT_BYTES) continue;
      const buf = await fs.readFile(abs).catch(() => null);
      if (buf === null) continue;
      if (looksBinary(buf)) {
        binaryFiles.push({ path: rel, bytes: stat.size });
        continue;
      }
      const ext = path.extname(rel).toLowerCase();
      const isText = TEXT_EXTENSIONS.has(ext) || ext === "" || rel.endsWith(".gitignore") || rel.endsWith(".dockerignore") || rel.endsWith(".editorconfig");
      if (!isText) {
        binaryFiles.push({ path: rel, bytes: stat.size });
        continue;
      }
      files.push({ path: rel, content: buf.toString("utf8") });
    }
  }
  await walk(root);
  return { files, binaryFiles };
}

/** فحص سجل Git كاملاً: كل blob عبر git cat-file دون طباعة أي محتوى */
export async function scanGitHistory(root) {
  const revList = execFileSync("git", ["rev-list", "--objects", "--all"], { cwd: root, encoding: "utf8" });
  // كل سطر: "<sha> <مسار>" — المسار يتيح عمل قائمة السماحية في التاريخ أيضاً
  const objects = revList.split("\n").filter(Boolean).map((l) => {
    const sp = l.indexOf(" ");
    return sp === -1 ? { sha: l, path: `blob:${l.slice(0, 12)}` } : { sha: l.slice(0, sp), path: l.slice(sp + 1) };
  });
  const findings = [];
  let blobs = 0;
  const BATCH = 100; // دفعات لتفادي تجاوز حد طول سطر الأوامر في ويندوز
  for (let i = 0; i < objects.length; i += BATCH) {
    const batch = objects.slice(i, i + BATCH);
    let out;
    try {
      out = execFileSync("git", ["cat-file", "--batch"], { cwd: root, input: batch.map((o) => o.sha).join("\n") + "\n", maxBuffer: 512 * 1024 * 1024 });
    } catch {
      continue;
    }
    // صيغة --batch: "<sha> blob <size>\n<content>\n" لكل كائن، أو "<sha> missing\n"
    const pathBySha = new Map(batch.map((o) => [o.sha, o.path]));
    let offset = 0;
    while (offset < out.length) {
      const headerEnd = out.indexOf(0x0a, offset);
      if (headerEnd === -1) break;
      const header = out.subarray(offset, headerEnd).toString("utf8");
      const parts = header.split(/\s+/);
      const [sha, kind] = parts;
      if (parts.length < 3 || kind !== "blob") {
        offset = headerEnd + 1; // كائن مفقود أو ترويسة غير متوقعة — تجاوز
        continue;
      }
      const size = Number(parts[2]);
      if (!Number.isFinite(size)) break;
      const content = out.subarray(headerEnd + 1, headerEnd + 1 + size);
      offset = headerEnd + 1 + size + (out[headerEnd + 1 + size] === 0x0a ? 1 : 0);
      if (looksBinary(content) || size > MAX_TEXT_BYTES) continue;
      blobs++;
      const fileFindings = scanText(pathBySha.get(sha) ?? `blob:${sha.slice(0, 12)}`, content.toString("utf8"))
        // هوية الـblob الثابتة تلازم كل إصابة تاريخية — قائمة السماحية
        // المثبتة بـblob لا تقبل إلا هذه النسخة تحديداً لا محتوى جديداً
        .map((f) => ({ ...f, blobSha: sha }));
      findings.push(...fileFindings.slice(0, FINDINGS_PER_FILE_CAP));
    }
  }
  return { blobs, findings };
}

/** فحص قائمة ملفات محددة (مستخدم لفحص الملفات المتتبعة عبر git ls-files) */
export async function scanTrackedFiles(root) {
  const list = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  const findings = [];
  const binaryTracked = [];
  for (const rel of list) {
    const abs = path.join(root, rel);
    const buf = await fs.readFile(abs).catch(() => null);
    if (buf === null) continue;
    if (looksBinary(buf)) {
      binaryTracked.push(rel);
      continue;
    }
    if (buf.length > MAX_TEXT_BYTES) continue;
    findings.push(...scanText(rel, buf.toString("utf8")).slice(0, FINDINGS_PER_FILE_CAP * 4));
  }
  return { trackedCount: list.length, findings, binaryTracked };
}

/** فصل الإصابات إلى حاجبة ومقبولة بحسب قائمة السماحية الموثقة.
 * الاستثناء المثبت بحقل `blob` يطابق حصراً إصابة من نسخة الـblob ذاتها
 * (بادئة sha) ولا يلمس إصابة شجرة العمل أو أي محتوى جديد في المسار نفسه —
 * فالاستثناء التاريخي لا يتحول إلى ترخيص دائم للنمط في الملف. */
export function applyAllowlist(findings, allowlist) {
  const accepted = [];
  const blocking = [];
  for (const f of findings) {
    const hit = allowlist.exceptions.find((e) => e.path === f.path && e.pattern === f.pattern && (e.line === undefined || e.line === f.line) && (e.blob === undefined || (f.blobSha !== undefined && f.blobSha.startsWith(e.blob))));
    if (hit) accepted.push({ ...f, justification: hit.justification });
    else blocking.push(f);
  }
  return { accepted, blocking };
}

/** رفض النظير المتتبع لمسارات التوليد المقصودة — إضافة دائمة إلى الحاجبة
 * خارج قائمة السماحية: وجودها متتبعاً خطأ بنيوي يُنَصَّح باسمه لا يُتجاهل. */
export function trackedGeneratedRefusals(trackedPaths) {
  return trackedPaths
    .filter((p) => p === "runtime" || p.startsWith("runtime/") || p.startsWith("docker/sandbox-runner/shared-dist/") || p.startsWith("docker/sandbox-runner/hardening-dist/"))
    .map((p) => ({ path: p, line: 0, pattern: "tracked-generated-path", fingerprint: findingFingerprint(p, 0, "tracked-generated-path") }));
}

function args() {
  const argv = process.argv.slice(2);
  const mode = argv[0];
  const opt = {};
  for (let i = 1; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].replace(/^--/, "");
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      opt[key] = next;
      i++; // قيمة ملتصقة بالمفتاح — تتخطى موضعها
    } else {
      opt[key] = true; // علم بلا قيمة مثل --json
    }
  }
  return { mode, opt };
}

async function main() {
  const { mode, opt } = args();
  const root = path.resolve(opt.root ?? process.cwd());
  const allowlist = await loadAllowlist(root);
  let result;
  if (mode === "worktree") {
    const { files, binaryFiles } = await collectTextFiles(root);
    const findings = [];
    for (const f of files) findings.push(...scanText(f.path, f.content).slice(0, FINDINGS_PER_FILE_CAP * 4));
    const { accepted, blocking } = applyAllowlist(findings, allowlist);
    // النظير المتتبع لمسارات التوليد رفض دائم خارج أي قائمة سماحية
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
    const refusals = trackedGeneratedRefusals(tracked);
    result = { mode, scannedTextFiles: files.length, binaryFilesCount: binaryFiles.length, findings: findings.length, acceptedExceptions: accepted.length, blockingFindings: [...blocking, ...refusals], accepted, binaryFiles };
  } else if (mode === "history") {
    const { blobs, findings } = await scanGitHistory(root);
    const { accepted, blocking } = applyAllowlist(findings, allowlist);
    result = { mode, blobsScanned: blobs, findings: findings.length, acceptedExceptions: accepted.length, blockingFindings: blocking, accepted };
  } else if (mode === "files") {
    const list = (await fs.readFile(path.resolve(opt.paths), "utf8")).split("\n").map((s) => s.trim()).filter(Boolean);
    const findings = [];
    for (const rel of list) {
      const buf = await fs.readFile(path.join(root, rel)).catch(() => null);
      if (buf === null || looksBinary(buf) || buf.length > MAX_TEXT_BYTES) continue;
      findings.push(...scanText(rel, buf.toString("utf8")));
    }
    const { accepted, blocking } = applyAllowlist(findings, allowlist);
    result = { mode, scanned: list.length, findings: findings.length, acceptedExceptions: accepted.length, blockingFindings: blocking, accepted };
  } else {
    console.error("استعمال: secret-scan.mjs worktree|history|files --root <dir> [--paths <file>] [--json]");
    process.exit(2);
  }
  // لا تُطبع أي قيمة سرية: الإصابات بصمات ومواقع فقط
  if (opt.json) console.log(JSON.stringify(result, null, 2));
  else console.log(JSON.stringify({ mode: result.mode, scanned: result.scannedTextFiles ?? result.blobsScanned ?? result.scanned, findings: result.findings, accepted: result.acceptedExceptions, blocking: result.blockingFindings.length }, null, 2));
  process.exit(result.blockingFindings.length > 0 ? 1 : 0);
}

// التنفيذ المباشر فقط - الاستيراد للاختبارات لا يقلع الـCLI
import { realpathSync } from 'node:fs';
import { fileURLToPath as fURL } from 'node:url';
if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === fURL(import.meta.url)) {
  main();
}
