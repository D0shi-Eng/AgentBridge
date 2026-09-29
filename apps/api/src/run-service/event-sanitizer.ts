/**
 * معقم أحداث الأنابيب — مخطط حجب موحد قبل أي بث أو تخزين.
 *
 * حدود الثقة: أحداث المنسق قد تحمل نصوصاً مشتقة من مواصفة العميل (ملخصات،
 * أسماء، أوصاف) — أي منها قد يحوي PII أو سلاسل تشبه الأسرار. القاعدة:
 *   1. السماح بالحقول المعلنة حصراً عبر PipelineEventSchema — كل حقل
 *      زائد يُسقط (allowlist لا denylist)، فلا تهريب كائنات داخلية.
 *   2. الملخص يمر عبر redactText (حجب أنماط الأسرار) ويُقص على حد طول —
 *      الحد يمنع تحويل الملخص إلى قناة بيانات غير محدودة.
 * نقطة واحدة تمر منها كل الأحداث (البث وL1 والتدقيق) — لا مسار جانبي.
 */

import { redactText } from "@agentbridge/infra";
import { PipelineEventSchema, type PipelineEvent } from "@agentbridge/shared";

/** أقصى طول لملخص الحدث بعد التنقية — فوقه قص موثق بعلامة صريحة */
export const MAX_EVENT_SUMMARY_CHARS = 300;

/**
 * يعقم حداً واحداً: حجب أسرار الملخص وقصه قبل التحقق المخططي (الطول
 * شأن نقل لا بطلان حدث)، ثم allowlist الحقول — كل حقل زائد يُسقط.
 * حد لا يطابق المخطط حتى بعد الترميم يُسقط كلياً بقرار موثق للمستدعي.
 */
export function sanitizePipelineEvent(event: PipelineEvent): PipelineEvent | null {
  const summary = redactText(String(event.summary ?? ""));
  const preTrimmed: PipelineEvent = {
    ...event,
    summary: summary.length > MAX_EVENT_SUMMARY_CHARS
      ? summary.slice(0, MAX_EVENT_SUMMARY_CHARS) + "…[مقصوص]"
      : summary,
  };
  const parsed = PipelineEventSchema.safeParse(preTrimmed);
  if (!parsed.success) return null;
  return parsed.data;
}
