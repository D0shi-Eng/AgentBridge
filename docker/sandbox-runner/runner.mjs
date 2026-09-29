/**
 * runner sandbox — يعمل **داخل** حاوية sandbox (غير موثوق المحتوى، موثوق الكود).
 *
 * ماهيته: منسق فحوص حية داخل العزل: يقرأ job JSON من stdin
 * (ملفات الخادم المولد + أهداف الفحص + الحدود)، يبني workspace تحت /work
 * (tmpfs)، يشغل recorded upstream وupstream العميل على loopback الحاوية
 * الداخلي حصراً، ينفذ مجموعة HD عبر دالة runLiveProbes المبنية مسبقاً،
 * ويطبع النتيجة JSON سطراً واحداً على stdout — المضيف يتحقق بها لاحقاً.
 *
 * القرارات الأمنية:
 *   - لا قراءة أي مدخل خارج stdin (لا paths من المحتوى غير الموثوق).
 *   - symlinks node_modules إلى deps الموثوقة المثبتة وقت بناء الصورة بنسخ
 *     مقفلة — المواصفة/الوكيل لا يختاران أي package.
 *   - timeout صارم يقتل كل الأطفال (SIGKILL للشجرة) وينظف /work.
 *   - سجلات stderr مقصوصة — لا تضخم المخرجات.
 */

import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";

const WORK_ROOT = "/work";
const SERVER_DIR = join(WORK_ROOT, "server");
const MAX_STDIN_BYTES = 64 * 1024;

/** سجل خطوات مقصوص — يخرج مع النتيجة للتدقيق */
const log = [];

function readStdinJson() {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    process.stdin.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_STDIN_BYTES) {
        reject(new Error("STDIN_TOO_LARGE"));
        process.stdin.destroy();
        return;
      }
      chunks.push(chunk);
    });
    process.stdin.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(new Error("STDIN_NOT_JSON: " + (error?.message ?? "?")));
      }
    });
    process.stdin.on("error", reject);
  });
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("RUNNER_TIMEOUT: " + label)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const startedAt = new Date().toISOString();
  const job = await readStdinJson();
  const files = job.files;
  const timeoutMs = Math.min(Number(job.timeoutMs) || 120_000, 180_000);
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error("JOB_INVALID: لا ملفات في job");
  }

  // 1) workspace نظيف تحت /work (tmpfs للقراءة/الكتابة فقط هنا)
  await rm(SERVER_DIR, { recursive: true, force: true });
  await mkdir(SERVER_DIR, { recursive: true });
  for (const file of files) {
    const target = join(SERVER_DIR, file.path);
    if (!target.startsWith(SERVER_DIR)) throw new Error("JOB_PATH_UNSAFE: " + file.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.contents, "utf8");
    log.push("wrote:" + file.path);
  }
  // deps الموثوقة — symlink واحد؛ node يحل عبره للوصول لـsdk/zod/shared/hardening
  await symlink("/opt/deps/node_modules", join(SERVER_DIR, "node_modules"));

  // 2) استيراد أدوات الفحص المبنية مسبقاً — live-probes حصراً (إغلاقه مغلق
  //     ولا يجر بقية الشجرة: generator/analyzer/agents ليست في الصورة)
  const hardening = await import("./node_modules/@agentbridge/hardening/dist/live-probes.js");
  // محمل tsx بمسار مطلق داخل deps الموثوقة — إقلاع مستقل عن cwd
  const { createRequire } = await import("node:module");
  const tsxPath = createRequire(join(SERVER_DIR, "package.json")).resolve("tsx");
  log.push("tsx:" + tsxPath);

  // 3) الفحوص الحية — upstream المسجل على loopback الحاوية الداخلي
  const probeOptions = {
    command: process.execPath,
    args: ["--import", `file://${tsxPath.replace(/\\/g, "/")}`, join(SERVER_DIR, "src", "server.ts")],
    cwd: SERVER_DIR,
    declaredToolNames: job.declaredToolNames ?? [],
    leakTarget: job.leakTarget,
    traversalTarget: job.traversalTarget,
    ...(job.expectEncoded !== undefined ? { expectEncoded: job.expectEncoded } : {}),
    ...(job.sequentialTarget !== undefined ? { sequentialTarget: job.sequentialTarget } : {}),
  };
  const result = await withTimeout(hardening.runLiveProbes(probeOptions), timeoutMs, "live-probes");

  const output = {
    ok: result.ok === true,
    startedAt,
    finishedAt: new Date().toISOString(),
    checks: result.ok === true ? result.value : [],
    error: result.ok === true ? undefined : String(result.error?.message ?? "live probes failed"),
    log,
  };
  process.stdout.write(JSON.stringify(output) + "\n");
}

main()
  .catch((error) => {
    process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message ?? error), log }) + "\n");
    process.exitCode = 1;
  })
  .finally(async () => {
    // تنظيف مضمون نجاحاً وفشلاً — /work tmpfs يمسح بفناء الحاوية أيضاً
    await rm(SERVER_DIR, { recursive: true, force: true }).catch(() => undefined);
  });
