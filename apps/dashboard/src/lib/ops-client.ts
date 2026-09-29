/**
 * عميل المراقبة التشغيلية — غلاف نقي فوق fetch عبر وكيل /api الداخلي.
 *
 * ماهيته: يجلب GET /ops/metrics و GET /health/detailed خلف مصادقة الجلسة.
 * وظيفته: يغذي صفحة /ops بنص المقاييس وحالة المكونات — بلا توكن في المتصفح:
 * المقاييس عبر المسار الجلسي /ops/metrics (إغلاق عيب 401)، والصحة جلسية أصلاً.
 * كيف: sessionFetch بكوكيز خادمية + أخطاء مميزة لكل جزء كي تعرض الصفحة
 * أي جزء تعذر تحميله تحديداً بدل عبارة عامة واحدة.
 */

import { sessionFetch } from "./session-fetch";

export interface HealthDetailed {
  readonly status: string;
  readonly db: string;
  readonly redis: string;
  readonly pgvector: string;
  readonly at: string;
}

/** يستخرج رسالة الخطأ من مغلف الخادم وإن غاب أعاد نص الحالة التقني المحايد */
async function errorFrom(response: Response): Promise<Error> {
  const text = await response.text();
  let message = `HTTP_${response.status}`; // نص تقني محايد — العرض يترجم محلياً
  let code = `HTTP_${response.status}`;
  try {
    const envelope = JSON.parse(text) as { error?: { code?: string; message?: string } };
    if (envelope.error?.message !== undefined) message = envelope.error.message;
    if (envelope.error?.code !== undefined) code = envelope.error.code;
  } catch { /* إبقاء العامة */ }
  // الحالة والرمز مرفقان كي يميز العرض الرفض المنظم (مثل حصر المشغّل) من العطل
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = response.status;
  error.code = code;
  return error;
}

export const opsClient = {
  /** يجلب مقاييس prometheus عبر المسار الجلسي المحمي — لا توكن ولا مسار عام */
  fetchMetrics: async (): Promise<string> => {
    const response = await sessionFetch("/api/ops/metrics");
    if (!response.ok) throw await errorFrom(response);
    return response.text();
  },
  /** يجلب حالة الصحة التفصيلية — خلف مصادقة المستأجر */
  fetchHealth: async (): Promise<HealthDetailed> => {
    const response = await sessionFetch("/api/health/detailed");
    if (!response.ok) throw await errorFrom(response);
    const text = await response.text();
    return JSON.parse(text) as HealthDetailed;
  },
};
