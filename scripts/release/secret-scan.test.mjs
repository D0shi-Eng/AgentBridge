/**
 * اختبارات انحدار ماسح الأسرار — عقد قائمة السماحية:
 * 1) الاستثناء المثبت بـblob يقبل حصراً إصابة نسخة الـblob ذاتها.
 * 2) DSN جديد مطابق في نفس المسار (شجرة أو blob آخر) = حاجب دائماً.
 * 3) النظير المتتبع لمسار توليد مقصود = رفض مسمى لا تجاهل.
 * 4) فحص تاريخ حي على مستودع مؤقت: النسخ المراجعة تُقبل والإصابة الجديدة تفشل.
 * تشغيل: node --test scripts/release/
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { applyAllowlist, collectTextFiles, scanText, trackedGeneratedRefusals, scanGitHistory, trackedGeneratedRefusals as refusals } from "./secret-scan.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const allowlist = JSON.parse(await (await import("node:fs/promises")).readFile(join(HERE, "secret-scan-allowlist.json"), "utf8"));

describe("تثبيت استثناءات database-dsn بblob", () => {
  const historical = [
    { path: "README.md", blob: "11974c578a816b0e" },
    { path: "README.md", blob: "6a9b6a57d228f137" },
    { path: "README.ar.md", blob: "45f2b0b1df75fa9c" },
    { path: "README.ar.md", blob: "586128572db5b1e8" },
    { path: "deploy/local/cmd-setup.ps1", blob: "742d8106e01a5180" },
  ];

  for (const { path, blob } of historical) {
    test("النسخة التاريخية المراجعة تُقبل: " + path + " @" + blob.slice(0, 8), () => {
      const finding = { path, line: 1, pattern: "database-dsn", blobSha: blob + "ffffffffffffffffffffffffffffffff".slice(0, 40 - blob.length) };
      const { accepted, blocking } = applyAllowlist([finding], allowlist);
      assert.equal(accepted.length, 1);
      assert.equal(blocking.length, 0);
    });
  }

  for (const { path } of historical) {
    test("DSN جديد في " + path + " = حاجب (بلا blob كإصابة شجرة، وبتغير النسخة كإصابة تاريخ)", () => {
      // إصابة شجرة العمل الحالية: بلا blobSha — الاستثناء المثبت لا يمسها
      const worktreeFinding = { path, line: 999, pattern: "database-dsn" };
      assert.equal(applyAllowlist([worktreeFinding], allowlist).blocking.length, 1);
      // إصابة تاريخية من blob جديد (محتوى أُضيف لاحقاً): لا تطابق التثبيت
      const newBlobFinding = { path, line: 999, pattern: "database-dsn", blobSha: "ffffffffffffffffffffffffffffffffffffffff" };
      assert.equal(applyAllowlist([newBlobFinding], allowlist).blocking.length, 1);
    });
  }

  test("نمط آخر في نفس المسار لا يستفيد من استثناء database-dsn", () => {
    const finding = { path: "README.md", line: 1, pattern: "aws-access-key", blobSha: "11974c578a816b0e" };
    assert.equal(applyAllowlist([finding], allowlist).blocking.length, 1);
  });
});

describe("رفض النظير المتتبع لمسارات التوليد", () => {
  test("runtime وجوار الصورة المتتبعون يُرفضون بمسمى", () => {
    const hits = refusals(["runtime", "runtime/secrets/api.env", "docker/sandbox-runner/shared-dist/index.js", "docker/sandbox-runner/hardening-dist/x.js"]);
    assert.equal(hits.length, 4);
    assert.ok(hits.every((h) => h.pattern === "tracked-generated-path"));
  });
  test("المسارات الشرعية لا تُرفض", () => {
    assert.equal(refusals(["README.md", "packages/infra/src/config.ts", "docker/sandbox-runner/Dockerfile"]).length, 0);
  });
});

describe("فحص حي على مستودع مؤقت", () => {
  const root = mkdtempSync(join(tmpdir(), "ab-secretest-"));
  const git = (args, opts = {}) => execFileSync("git", args, { cwd: root, encoding: "utf8", ...opts });
  const DSN = "postgresql://svc:secret-pw@db.internal:5432/app";

  test("تجهيز مستودع مؤقت: نسخة تاريخية مراجَعة ثم إصابة جديدة", () => {
    git(["init", "-b", "main"]);
    git(["config", "user.email", "t@t"]);
    git(["config", "user.name", "t"]);
    // نسخة تاريخية بنفس سطر التوثيق القديم المعروف (عنصر نائب بمسافة؟ لا —
    // نستخدم صيغة النسخة القديمة الحرفية كي يولد blob مستقلاً نثبته هنا)
    writeFileSync(join(root, "README.md"), "# doc\nDATABASE_URL='postgresql://ab_app:<pass>@localhost:5433/agentbridge'\n");
    mkdirSync(join(root, "runtime"), { recursive: true });
    writeFileSync(join(root, "runtime", "note.txt"), "runtime local note - not repo content");
    git(["add", "."]);
    git(["commit", "-m", "historical doc"]);
  });

  const historicalBlob = () => execFileSync("git", ["rev-parse", "HEAD:README.md"], { cwd: root, encoding: "utf8" }).trim();

  test("النسخة التاريخية تُقبل فقط عند تثبيتها بblob هذه النسخة", async () => {
    const blob = historicalBlob();
    const { blobs } = await scanGitHistory(root);
    assert.ok(blobs >= 2); // README + runtime/note
    const synthetic = { exceptions: [{ path: "README.md", pattern: "database-dsn", blob: blob.slice(0, 16), justification: "نسخة المراجعة في هذا الاختبار" }] };
    const findings = (await scanGitHistory(root)).findings.filter((f) => f.pattern === "database-dsn");
    assert.equal(findings.length, 1);
    assert.equal(findings[0].blobSha, blob);
    const { accepted, blocking } = applyAllowlist(findings, synthetic);
    assert.equal(accepted.length, 1);
    assert.equal(blocking.length, 0);
  });

  test("إصابة جديدة (blob مختلف) في نفس المسار تفشل حتى مع الاستثناء المثبت", async () => {
    writeFileSync(join(root, "README.md"), "# doc v2\n" + DSN + "\n");
    git(["add", "."]);
    git(["commit", "-m", "new dsn"]);
    const blob = historicalBlob();
    assert.notEqual(blob, execFileSync("git", ["rev-parse", "HEAD~1:README.md"], { cwd: root, encoding: "utf8" }).trim());
    const synthetic = { exceptions: [{ path: "README.md", pattern: "database-dsn", blob: execFileSync("git", ["rev-parse", "HEAD~1:README.md"], { cwd: root, encoding: "utf8" }).trim().slice(0, 16), justification: "نسخة المراجعة فقط" }] };
    const findings = (await scanGitHistory(root)).findings.filter((f) => f.pattern === "database-dsn");
    assert.equal(findings.length, 2);
    const { blocking } = applyAllowlist(findings, synthetic);
    assert.equal(blocking.length, 1);
    assert.equal(blocking[0].blobSha, blob);
  });

  test("فحص شجرة العمل: DSN جديد حاجب + النظير المتتبع مرفوض ومحتوى runtime غير مفحوص", async () => {
    const { files } = await collectTextFiles(root);
    // runtime/note.txt غير مفحوص كنص (مسار التوليد مستثنى بنيوياً)
    assert.equal(files.filter((f) => f.path.startsWith("runtime/")).length, 0);
    const findings = [];
    for (const f of files) findings.push(...scanText(f.path, f.content));
    const { blocking } = applyAllowlist(findings, allowlist);
    assert.equal(blocking.filter((f) => f.path === "README.md" && f.pattern === "database-dsn").length, 1);
    const tracked = git(["ls-files"]).split("\n").map((s) => s.trim()).filter(Boolean);
    const refusalsList = trackedGeneratedRefusals(tracked);
    // git لا يتتبع المجلد الفارغ — النظير المتتبع هو الملف داخله حصراً
    assert.equal(refusalsList.length, 1);
    assert.equal(refusalsList[0].path, "runtime/note.txt");
  });

  test("تنظيف المؤقت", () => {
    rmSync(root, { recursive: true, force: true });
    assert.ok(true);
  });
});
