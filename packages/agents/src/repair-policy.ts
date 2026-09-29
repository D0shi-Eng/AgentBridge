/**
 * سياسة حدود الترقيع: حدود ملفات/حجم/مسارات/زمن
 * تفرض على كل اقتراح إصلاح قبل لمس نسخة العمل.
 *
 * ماهيتها: بوابة حتمية نقية فوق RepairPatch — لا نموذج ولا قراءة نظام ملفات.
 * وظيفتها:
 *   1. canonical مسارات فقط: رفض `..` والمطلق والمائل-عكسي ومحارف ويندوز —
 *      لا خروج من artifact workspace ولا symlink-pattern.
 *   2. امتدادات مسموحة حصراً + ملفات قائمة حصراً (البوابة القائمة) — ملفات
 *      المنصة packages/apps/infra ليست ضمن artifact أصلاً فلا أرضية لمسها.
 *   3. سقوف حجم: بايت لكل ملف، بايتات للترقيع كله، سقف نمو الـartifact —
 *      لا إعادة كتابة ملفات كاملة عملاقة ولا تضخم مقنع.
 *   4. deadline الدورة: زمن الجدار المحقون — تجاوزه رفض صريح برمز موحد.
 * كيف: دوال نقية تستقبل الأزمنة محقونة لتبقى الاختبارات حتمية.
 */

import { AppError, err, ok, type GeneratedFile, type RepairPatch, type Result } from "@agentbridge/shared";

/** سياسة الحدود — الافتراضيات مثبتة في وثيقة security.md §2 ولا تجزأ صامتاً */
export interface RepairPatchPolicy {
  /** امتدادات الملفات القابلة للترقيع — خارجهما رفض */
  readonly allowedExtensions: readonly string[];
  /** سقف بايت لمحتوى الملف الواحد بعد الترقيع */
  readonly maxFileBytes: number;
  /** سقف بايت لمجموع محتويات الترقيع */
  readonly maxPatchTotalBytes: number;
  /** سقف نمو الـartifact الكلي (مجموع الفروقات الموجبة) */
  readonly maxArtifactGrowthBytes: number;
}

export const DEFAULT_REPAIR_PATCH_POLICY: RepairPatchPolicy = {
  allowedExtensions: [".ts", ".json", ".md"],
  maxFileBytes: 256 * 1024,
  maxPatchTotalBytes: 512 * 1024,
  maxArtifactGrowthBytes: 256 * 1024,
};

const byteLength = (text: string): number => Buffer.byteLength(text, "utf8");

/**
 * فحص canonical لمسار داخل artifact: posix فقط، لا `..`، لا مطلق، لا مائل
 * عكسي، لا حرف قيادة ويندوز، لا مقاطع فارغة متتالية — يرفض أنماط الخروج
 * من المسار قبل أي استعمال لاحق.
 */
export function isCanonicalArtifactPath(path: string): boolean {
  if (path.length === 0) return false;
  if (path.includes("\\") || path.includes("\0")) return false;
  if (path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return false;
  const segments = path.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

/** بوابة الحدود الكاملة على اقتراح ترقيع — تعمل مع بوّابات validatePatch القائمة */
export function enforcePatchPolicy(
  patch: RepairPatch,
  currentFiles: readonly GeneratedFile[],
  policy: RepairPatchPolicy = DEFAULT_REPAIR_PATCH_POLICY,
): Result<void> {
  const known = new Map(currentFiles.map((file) => [file.path, file]));
  let totalBytes = 0;
  let growthBytes = 0;

  for (const file of patch.files) {
    // 1) canonical المسار — لا traversal ولا صيغ بديلة
    if (!isCanonicalArtifactPath(file.path)) {
      return err(new AppError("REPAIR_PATH_UNSAFE", `مسار الترقيع غير canonical ومرفوض: ${file.path}`));
    }
    // 2) الامتداد المسموح — لا أنواع خارج القائمة
    const extension = file.path.slice(file.path.lastIndexOf("."));
    if (!policy.allowedExtensions.includes(extension)) {
      return err(new AppError("REPAIR_EXTENSION_FORBIDDEN", `امتداد ${extension} غير مسموح في الترقيع (${file.path})`));
    }
    // 3) الملف قائم أصلاً (بوابة الوجود تتكرر هنا قبل حساب السقوف)
    const existing = known.get(file.path);
    if (existing === undefined) {
      return err(new AppError("REPAIR_PATH_UNSAFE", `ملف غير قائم في artifact — الترقيع لا يضيف ملفات: ${file.path}`));
    }
    // 4) سقوف الحجم
    const newBytes = byteLength(file.contents);
    if (newBytes > policy.maxFileBytes) {
      return err(new AppError("REPAIR_FILE_TOO_LARGE", `${file.path} (${newBytes}B) فوق سقف الملف ${policy.maxFileBytes}B`));
    }
    totalBytes += newBytes;
    growthBytes += Math.max(0, newBytes - byteLength(existing.contents));
  }

  if (totalBytes > policy.maxPatchTotalBytes) {
    return err(new AppError("REPAIR_PATCH_TOO_LARGE", `مجموع الترقيع ${totalBytes}B فوق السقف ${policy.maxPatchTotalBytes}B`));
  }
  if (growthBytes > policy.maxArtifactGrowthBytes) {
    return err(new AppError("REPAIR_GROWTH_TOO_LARGE", `نمو الـartifact ${growthBytes}B فوق السقف ${policy.maxArtifactGrowthBytes}B`));
  }
  return ok(undefined);
}

/** نتيجة فحص deadline — سبب الرفض برمز موحد للتصعيد */
export function enforceRepairDeadline(startedAtMs: number, deadlineMs: number, nowMs: number): Result<void> {
  if (nowMs - startedAtMs > deadlineMs) {
    return err(new AppError("REPAIR_DEADLINE_EXCEEDED", `تجاوزت دورة الإصلاح مهلة ${deadlineMs}ms — تصعيد`));
  }
  return ok(undefined);
}
