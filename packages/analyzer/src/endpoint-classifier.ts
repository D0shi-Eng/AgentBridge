/**
 * مصنّف النقاط — المحلل الأول في نظام التحليل.
 *
 * الوظيفة: إعطاء كل endpoint تصنيفاً من منظور العمل:
 * - read       : قراءة بيانات (GET)
 * - write      : تعديل/إنشاء/حذف بيانات الأعمال
 * - management : نقاط تشغيلية للبنية (صحة، مقاييس، إصدار) لا قيمة عميلية لها
 * - admin      : مناطق خلف الكواليس (admin/internal) صلاحياتها حساسة
 *
 * القواعد حتمية مرتّبة بالأولوية — أول قاعدة تطابق تحسم القرار.
 */

import type { EndpointKind } from "@agentbridge/shared";

/** أفعال القراءة الوحيدة المعتمدة */
const READ_METHODS: ReadonlySet<string> = new Set(["get", "head", "options"]);

/** أسماء مسارات البنية التشغيلية — لا تمثل وظيفة أعمال */
const INFRA_SEGMENTS: ReadonlySet<string> = new Set([
  "health", "healthz", "status", "metrics", "version", "ping", "info",
]);

/** أسماء المناطق الإدارية الحساسة */
const ADMIN_SEGMENTS: ReadonlySet<string> = new Set(["admin", "internal", "backoffice"]);

/** استخلاص مقاطع المسار بحروف صغيرة */
function pathSegments(path: string): readonly string[] {
  return path
    .toLowerCase()
    .split("/")
    .filter((segment) => segment.length > 0 && !segment.startsWith("{"));
}

/**
 * تصنيف عملية واحدة حتمياً.
 * ترتيب الأولويات: إدارية ← بنية تشغيلية ← قراءة ← كتابة.
 */
export function classifyEndpoint(path: string, method: string): EndpointKind {
  const segments = pathSegments(path);

  if (segments.some((segment) => ADMIN_SEGMENTS.has(segment))) return "admin";
  if (segments.some((segment) => INFRA_SEGMENTS.has(segment))) return "management";
  if (READ_METHODS.has(method)) return "read";
  return "write";
}
