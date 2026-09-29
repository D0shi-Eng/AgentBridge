/**
 * نمط Result — بديل آمن عن الاستثناءات عبر حدود الوحدات.
 *
 * الفكرة: كل عملية قد تفشل تعيد إما نجاحاً بقيمة أو فشلاً بخطأ منظّم.
 * هذا يجبر المستدعي على معالجة الفشل صراحة بدل تجاهله،
 * ويمنع الاستثناءات من العبور بين طبقات المشروع دون قصد.
 */

/** نتيجة ناجحة تحمل القيمة */
export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

/** نتيجة فاشلة تحمل خطأنا الموحد */
import type { AppError } from "../errors/app-error.js";

export interface Err {
  readonly ok: false;
  readonly error: AppError;
}

/** الاتحاد الأساسي الذي تعيد به كل دوال المشروع نتائجها */
export type Result<T> = Ok<T> | Err;

/** مُنشئ نتيجة ناجحة */
export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

/** مُنشئ نتيجة فاشلة */
export function err(error: AppError): Result<never> {
  return { ok: false, error };
}
