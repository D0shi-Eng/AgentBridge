/**
 * كاتب artifact على القرص — الوحيد في الحزمة الذي يلمس نظام الملفات.
 *
 * حراس الأمان: إن كان المجلد الهدف موجوداً وغير فارغ رفض الكتابة
 * (GEN_DIR_NOT_EMPTY حرج) — لا طمس فوق عمل قائم أبداً.
 */

import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { GeneratedServerArtifact } from "@agentbridge/shared";
import { err, ok, type Result } from "@agentbridge/shared";
import { GenErrors } from "./errors.js";

export interface WriteOptions {
  /** المجلد الهدف (يُنشأ مع آبائه عند الحاجة) */
  readonly targetDir: string;
}

/** يكتب ملفات artifact داخل مجلد الهدف ويقفل المسار برسالة النجاح */
export async function writeArtifact(
  artifact: GeneratedServerArtifact,
  options: WriteOptions,
): Promise<Result<{ readonly writtenFiles: number }>> {
  if (existsSync(options.targetDir)) {
    // المجلد قائم — نسمح فقط إن كان فارغاً تماماً
    const existing = await readdirSafe(options.targetDir);
    if (existing.length > 0) return err(GenErrors.dirNotEmpty(options.targetDir));
  }
  await mkdir(options.targetDir, { recursive: true });
  const resolvedTarget = resolve(options.targetDir);

  for (const file of artifact.files) {
    const absolutePath = join(options.targetDir, file.path);
    // حارس اجتياز مسارات: المسار المحسوم يجب أن يبقى داخل المجلد الهدف
    const resolvedFile = resolve(absolutePath);
    if (!resolvedFile.startsWith(resolvedTarget + sep)) {
      return err(GenErrors.dirNotEmpty(`مسار خارج المجلد الهدف: ${file.path}`));
    }
    await mkdir(join(resolvedFile, ".."), { recursive: true });
    await writeFile(resolvedFile, file.contents, "utf8");
  }

  return ok({ writtenFiles: artifact.files.length });
}

/** قراءة أسماء محتويات مجلد بأمان (مجلد غير موجود = قائمة فارغة) */
async function readdirSafe(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(dir);
  } catch {
    return [];
  }
}
