/**
 * منفذ مزودي النماذج اللغوية — العقد الوحيد الذي تعرفه باقي الحزم.
 *
 * الفكرة المعمارية (ADR-8): لا حزمة تتحدث مع SDK مورد مباشرة؛
 * كل مزود (Anthropic/OpenAI/mock) ينفذ هذه الواجهة، والتبديل بينها
 * يتم عند التجميع دون لمس منطق الوكلاء.
 *
 * كل نداء يعيد Result — فشل الشبكة لا يُرمى استثناءً بل يُدار بقرار المنسق.
 */

import type { Result } from "@agentbridge/shared";

/** رسالة واحدة في سياق الحوار */
export interface LlmMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** طلب إكمال واحد: مطالبة نظام + سياق رسائل + ضبط توليد */
export interface LlmRequest {
  /** مطالبة النظام (الدور/القيود/عقد المخرج) */
  readonly system: string;
  /** تسلسل الرسائل بالترتيب الزمني */
  readonly messages: readonly LlmMessage[];
  /** درجة الحرارة — التصميم 0.2 والتقييم 0 وفق وثيقة 09 */
  readonly temperature?: number;
  /** سقف رموز الإخراج */
  readonly maxOutputTokens?: number;
}

/** استعمال رموز موحد — يغذي جدول التكلفة الحتمي */
export interface LlmUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** استجابة مزود ناجحة */
export interface LlmResponse {
  /** النص الخام كما أعاده المزود — يدخل بوابة التحقق قبل أي استخدام */
  readonly text: string;
  /** اسم المزود الذي أنتج الاستجابة (للتدقيق) */
  readonly provider: string;
  /** استعمال الرموز إن أفصح المزود عنه — صفر عند mock */
  readonly usage?: LlmUsage;
}

/** المنفذ الذي تنفذه كل محولات المزودين */
export interface LlmProvider {
  /** معرف المزود لأغراض السجل والتدقيق */
  readonly name: string;
  complete(request: LlmRequest): Promise<Result<LlmResponse>>;
}
