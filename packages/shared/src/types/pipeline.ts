/**
 * أنواع مسار المعالجة — العمود الفقري للمنسق.
 *
 * تعرّف مراحل التشغيل الثماني وحالة كل مرحلة والأحداث التي تُسجل.
 * المنسق (orchestrator) والوكلاء يتحدثون بهذه الأنواع فقط،
 * فتظل الحزم مستقلة عن بعضها ومرتبطة بعقود مشتركة صارمة.
 */

import { z } from "zod";

/** المراحل الثماني لمسار المعالجة بالترتيب التنفيذي */
export const StageIds = [
  "load_spec",
  "normalize",
  "analyze",
  "design_tools",
  "generate_server",
  "harden",
  "evaluate",
  "certify",
] as const;

export type StageId = (typeof StageIds)[number];

/** حالة مرحلة واحدة خلال تشغيل معين */
export const StageStatus = z.enum([
  "pending", // لم تصل بعد
  "running", // تعمل الآن
  "completed", // نجحت
  "failed", // فشلت نهائياً
  "needs_repair", // فشلت وأُحيلت لوكيل الإصلاح
  "needs_human", // استُنفدت دورات الإصلاح — تدخل بشري
]);

export type StageStatus = z.infer<typeof StageStatus>;

/**
 * كود حدث مستقر — معرف لغوي محايد تعرضه الواجهة مترجماً حسب
 * locale بدل الملخص الخام. الصيغة `مجال.حدث` بأحرف صغيرة وأرقام و_ و. حصراً
 * كي لا يتحول الكود نفسه إلى قناة حقن. الملخص العربي يبقى بيانات خلفية
 * (L1 + تدقيق) ولا يُعرض خاماً في واجهة إنجليزية.
 */
export const EVENT_CODE_PATTERN = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/u;

/** حدث واحد في سجل تشغيل الأنابيب (يغذّي L1 وسجل التدقيق) */
export interface PipelineEvent {
  /** معرف التشغيل الذي وقع فيه الحدث */
  readonly runId: string;
  /** معرف المستأجر — إلزامي في كل حدث لعزل البيانات */
  readonly tenantId: string;
  /** المرحلة التي وقع فيها الحدث */
  readonly stage: StageId;
  /** زمن وقوع الحدث بتوقيت ISO */
  readonly at: string;
  /** ملخص مقروء بالعربية — بيانات خلفية؛ العرض العام يمر عبر code */
  readonly summary: string;
  /** هل غيّر الحدث حالة مرحلة؟ إن نعم تحمل القيمة الجديدة */
  readonly stageStatus?: StageStatus;
  /** كود الحدث المستقر — اختياري لتوافق الأحداث التاريخية */
  readonly code?: string;
  /**
   * معاملات منظمة للترجمة — قيم نصية/رقمية قصيرة حصراً (أرقام
   * وأكواد تقنية)؛ لا نصوصاً مشتقة من مواصفة العميل كي لا تتسرب عبر العرض.
   */
  readonly params?: Readonly<Record<string, string | number>>;
}

/** مخطط تحقق الحدث عند عبوره حدود العملية (طابور/شبكة) */
export const PipelineEventSchema = z.object({
  runId: z.string().min(1),
  tenantId: z.string().min(1),
  stage: z.enum(StageIds),
  at: z.string().datetime(),
  summary: z.string().max(500),
  stageStatus: StageStatus.optional(),
  code: z.string().max(64).regex(EVENT_CODE_PATTERN, "صيغة كود الحدث غير سليمة").optional(),
  params: z.record(z.string().max(200), z.union([z.string().max(200), z.number()])).optional(),
});
