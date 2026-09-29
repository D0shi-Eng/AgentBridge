/**
 * عميل حلقة التعلّم — غلاف نقي فوق fetch عبر وكيل /api الداخلي.
 *
 * ماهيته: ثلاث عمليات خلف مصادقة المستأجر: قائمة، بحث دلالي بأعلى k نتائج، حذف.
 * وظيفته: يغذي صفحة /flywheel بجدول الدروس مع بحث وحذف بتوكيد.
 * كيف: session cookie خادمية + CSRF مركزي + تحويل أخطاء لرسالة عربية.
 */

import type { Credentials } from "./api-client";
import { sessionFetch } from "./session-fetch";

// درس كما يعيده الخادم — id حتمي مشتق من الحقول
export interface Lesson {
  readonly id: string;
  readonly specPattern: string;
  readonly designDecision: string;
  readonly outcome: "success" | "failure";
  readonly score: number;
  readonly tenantId: string;
  readonly createdAt: string;
}

async function requestJson<T>(_session: Credentials, path: string, init?: RequestInit): Promise<T> {
  const response = await sessionFetch(`/api${path}`, init);
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

export const flywheelClient = {
  /** قائمة أحدث 50 درساً بترتيب score */
  list: (creds: Credentials) => requestJson<{ lessons: Lesson[] }>(creds, "/flywheel/lessons"),
  /** بحث دلالي داخل المستأجر يعيد أعلى k نتائج تطابقاً */
  search: (creds: Credentials, query: string, k: number) =>
    requestJson<{ lessons: Lesson[] }>(creds, `/flywheel/lessons?query=${encodeURIComponent(query)}&k=${String(k)}`),
  /** حذف درس مع عزل مستأجر + فهرس L3 */
  remove: (creds: Credentials, id: string) =>
    requestJson<{ deleted: boolean }>(creds, `/flywheel/lessons/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
