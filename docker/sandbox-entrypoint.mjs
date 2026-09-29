/** بوابة احتواء: تحقق من runner مبني حقيقي قبل التشغيل؛ لا نجاح افتراضي ولا محاكاة للفحوص. */
import { stat } from "node:fs/promises";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const RUNNER_PATH = "packages/hardening/dist/sandbox-runner.js";

export async function requireRunner(root) {
  const file = resolve(root, RUNNER_PATH);
  try {
    const info = await stat(file);
    if (!info.isFile() || info.size === 0) throw new Error();
  } catch {
    throw new Error("ملف فحوص الحاوية المبني مفقود — Built sandbox runner is missing");
  }
  return file;
}

async function main() {
  const file = await requireRunner(process.cwd());
  if (process.argv[2] === "--check") return;
  // المسار ثابت من كود المشغل، ولا يستقبل مساراً من المدخل غير الموثوق.
  await import(pathToFileURL(file).href);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "تعذر التشغيل — Startup failed");
    process.exitCode = 1;
  });
}
