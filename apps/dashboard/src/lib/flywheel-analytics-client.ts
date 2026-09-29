/**
 * عميل تحليلات حلقة التعلّم — غلاف نقي فوق fetch عبر وكيل /api الداخلي.
 *
 * ماهيته: يجلب GET /flywheel/analytics?range=7d|30d|90d مع مصادقة المستأجر.
 * وظيفته: يغذي صفحة /flywheel/analytics بالبطاقات والهيستوغرام والاتجاه.
 * كيف: session cookie خادمية بلا أسرار في JavaScript.
 */

import type { Credentials } from "./api-client";
import { sessionFetch } from "./session-fetch";

// أنواع التحليلات — مطابقة لمنفذ memory FlywheelAnalytics
export type FlywheelRange = "7d" | "30d" | "90d";
export interface FlywheelAnalytics {
  readonly totalLessons: number;
  readonly avgScore: number;
  readonly successRate: number;
  /** الدروس الناجحة ضمن العينة — تُعرض مع النسبة (مثل «2 من 2») */
  readonly successCount: number;
  readonly histogram: readonly number[];
  readonly topPatterns: readonly { readonly pattern: string; readonly count: number; readonly avgScore: number }[];
  readonly trend: readonly { readonly date: string; readonly count: number }[];
}

async function requestJson<T>(_session: Credentials, path: string): Promise<T> {
  const response = await sessionFetch(`/api${path}`);
  const text = await response.text();
  if (!response.ok) {
    let message = ""; // الرسالة من الخادم إن وجدت — وإلا تُترجم محلياً
    try {
      const envelope = JSON.parse(text) as { error?: { message?: string } };
      if (envelope.error?.message !== undefined) message = envelope.error.message;
    } catch { /* إبقاء العامة */ }
    throw new Error(message);
  }
  return (text.length === 0 ? ({} as T) : (JSON.parse(text) as T));
}

export const flywheelAnalyticsClient = {
  /** يجلب التحليلات لنطاق زمني — معزول بالمستأجر */
  fetch: (creds: Credentials, range: FlywheelRange) => requestJson<FlywheelAnalytics>(creds, `/flywheel/analytics?range=${encodeURIComponent(range)}`),
};
