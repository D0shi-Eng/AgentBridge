/**
 * عقد الأداة الموحد — مطابق حرفياً لوثيقة 05 §Tool Contract.
 *
 * كل قدرة تمنح لأي وكيل هي AgentTool: مدخل Zod يرفض قبل التنفيذ،
 * مخرج Zod يرفض بعده، وتنفيذ حتمي يعيد Result ولا يرمي استثناءات.
 * مبدأ الحد الأدنى للصلاحية: كل وكيل يرى أدواته هو فقط.
 */

import { Errors, err, ok, type Result } from "@agentbridge/shared";
import type { ZodType } from "zod";

/** السياق الذي تُمرر به كل أداة — يتسع لاحقاً لسجل التدقيق والهوية */
export interface ToolContext {
  /** معرف المستأجر صاحب التشغيل — إلزامي لعزل البيانات */
  readonly tenantId: string;
}

/** الواجهة التي تنفذها كل أداة وكيل في هذا المشروع */
export interface AgentTool<TInput, TOutput> {
  /** اسم فريد يُعرض للنموذج */
  readonly name: string;
  /** مخطط تحقق المدخل — يرفض قبل التنفيذ */
  readonly inputSchema: ZodType<TInput>;
  /** مخطط تحقق المخرج — يرفض بعد التنفيذ */
  readonly outputSchema: ZodType<TOutput>;
  /** وصف قصير بالعربية لوظيفة الأداة (للسجل والمطالب) */
  readonly description: string;
  execute(input: TInput, ctx: ToolContext): Promise<Result<TOutput>>;
}

/**
 * بوابة المدخل الموحدة — تنفذ بند العقد "يرفض قبل التنفيذ".
 * كل أداة تستدعيها أول سطر في execute فلا يصل منطقها إلا مدخل مطابق.
 */
export function validateToolInput<T>(toolName: string, schema: ZodType<T>, raw: unknown): Result<T> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return err(
      Errors.invalidInput(`مدخل الأداة ${toolName} خالف مخططها: ${parsed.error.issues[0]?.message ?? ""}`),
    );
  }
  return ok(parsed.data);
}
