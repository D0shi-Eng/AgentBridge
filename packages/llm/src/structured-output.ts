/**
 * بوابة المخرجات المهيكلة — البوابة 2 من طبقة الحقيقة (وثيقة 08).
 *
 * القاعدة: نص النموذج الخام ممنوع أن يدخل النظام كما هو.
 * المسار الإلزامي: استخلاص كتلة JSON ← تحليل ← تحقق Zod صارم ← قيمة مطابقة.
 * أي مخالفة = LLM_OUTPUT_INVALID (قابلة للإصلاح) — لا إصلاح صامت ولا تخمين.
 */

import { Errors, err, ok, type Result } from "@agentbridge/shared";
import type { ZodType } from "zod";

/**
 * يستخلص جسم JSON من نص النموذج:
 * - أسوار ```json ... ``` تُنزع إن وُجدت.
 * - وإلا يُقبل النص كله بعد التنظيف (المطالب تلزم النموذج بـ JSON مجرد).
 */
export function extractJsonBlock(text: string): Result<string> {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(text);
  const candidate = (fenced?.[1] ?? text).trim();
  if (candidate.length === 0) {
    return err(Errors.llmOutputInvalid("extract-json"));
  }
  return ok(candidate);
}

/**
 * المدخل الرئيسي للبوابة: نص خام + مخطط مستهدف → قيمة موثوقة أو خطأ منظم.
 * @param agent اسم الوكيل صاحب النداء — يظهر في الخطأ لأغراض التدقيق
 */
export function parseStructuredOutput<T>(
  rawText: string,
  schema: ZodType<T>,
  agent: string,
): Result<T> {
  const extracted = extractJsonBlock(rawText);
  if (!extracted.ok) {
    return err(Errors.llmOutputInvalid(agent));
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(extracted.value) as unknown;
  } catch {
    return err(
      Errors.llmOutputInvalid(`${agent}: المخرج ليس JSON صالحاً`),
    );
  }

  const validated = schema.safeParse(parsedJson);
  if (!validated.success) {
    // أول ثلاث مخالفات فقط في الرسالة — كفاية لتوجيه وكيل الإصلاح دون ضجيج
    const issues = validated.error.issues
      .slice(0, 3)
      .map((issue) => `${issue.path.join(".") || "(جذر)"}: ${issue.message}`)
      .join("؛ ");
    return err(Errors.llmOutputInvalid(`${agent} [${issues}]`));
  }

  return ok(validated.data);
}
