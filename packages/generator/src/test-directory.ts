/** حذف مخرجات الاختبار المعروفة فقط بعد إثبات احتواء المسار داخل .tmp المحدد. */
import { rm } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../tests/e2e/.tmp/", import.meta.url));
export async function cleanTestDirectory(path: string): Promise<void> {
  const target = resolve(path);
  const inside = relative(root, target);
  if (isAbsolute(inside) || !["mini-petstore-server", "mini-petstore-seq"].includes(inside)) {
    throw new Error("مجلد اختبار غير مسموح — Test directory is not allowed");
  }
  await rm(target, { recursive: true, force: true });
}
