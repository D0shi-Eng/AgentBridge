/**
 * مفاتيح الذاكرة العرضية L1 — التسمية الملزمة لكل المحولات (وثيقة memory.md §L1).
 *
 * ملف مشترك حتمي صفر تبعيات: تستخدمه حزمة memory ومحولات infra معاً
 * حتى لا تتضاعف قاعدة التسمية ولا تنحرف بين المحولات.
 * كل مفتاح يبدأ بمعرف المستأجر تطبيقاً للقاعدة: "لا ذاكرة بلا مستأجر".
 */

/** عمر مفاتيح L1 الافتراضي: 7 أيام ثم الطرد للأرشيف البارد */
export const EPISODIC_TTL_SECONDS = 7 * 24 * 60 * 60;

/** مفتاح stream أحداث تشغيل واحد */
export function pipelineEventsKey(tenantId: string, runId: string): string {
  return `pipeline:${tenantId}:${runId}:events`;
}

/** مفتاح hash حالة التشغيل: status وsnapshot آخر مرحلة مكتملة */
export function pipelineStateKey(tenantId: string, runId: string): string {
  return `pipeline:${tenantId}:${runId}:state`;
}

/** اسم حقل snapshot داخل hash الحالة */
export const RUN_SNAPSHOT_FIELD = "snapshot";

/** اسم حقل حالة التشغيل النصية داخل hash الحالة */
export const RUN_STATUS_FIELD = "status";
