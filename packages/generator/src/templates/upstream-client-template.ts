/**
 * قالب upstream-client.ts — عميل HTTP واحد لكل أدوات الخادم المولد.
 *
 * قواعد أمنية أساسية (التحصين الكامل في جناح التحصين + إصلاحات حارس العنوان والقراءة المتدفقة):
 * - مهلة صارمة لكل نداء.
 * - حارس عنوان قبل الاتصال: http(s) فقط بلا بيانات اعتماد في الـURL؛
 *   http غير المشفر محصور على loopback (بيئات الاختبار) — الإنتاج https.
 * - سقف بايتات يُطبق أثناء القراءة المتدفقة — الرفض يقطع الاتصال قبل
 *   اكتمال تحميل جسم ضخم لا بعده.
 * - رسائل الفشل لا تعكس جسم الاستجابة (صد تسريب PII عبر الأخطاء).
 * - المفتاح يمرر ترويسةً ولا يسجل أبداً.
 */

export function renderUpstreamClient(): string {
  return `/** نتيجة نداء upstream كما تعيدها الأدوات للمستهلك */
export interface UpstreamResult {
  readonly status: number;
  readonly ok: boolean;
  /** الجسم محللاً JSON إن كان قابلاً للتحليل، وإلا نص خام */
  readonly body: unknown;
}

import type { ServerConfig } from "./config.js";

/** سقف جسم الاستجابة بالبايتات — يُطبق أثناء القراءة لا بعدها */
const MAX_BODY_BYTES = 524288;

interface CallOptions {
  readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** مسار جاهز بعد استيفاء معاملات المسار */
  readonly path: string;
  readonly query?: URLSearchParams;
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
}

/** حارس العنوان: بروتوكول مسموح، بلا اعتماد مضمّنة، http للـloopback فقط */
export function assertSafeUpstreamUrl(url: URL): void {
  const host = url.hostname.toLowerCase();
  const isLoopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error("UPSTREAM_URL_REJECTED");
  }
  if (url.username !== "" || url.password !== "") throw new Error("UPSTREAM_URL_REJECTED");
}

/** نداء واحد نحو الـAPI الأصلي — الوحيد الذي يلمس الشبكة */
export async function callUpstream(
  config: ServerConfig,
  options: CallOptions,
): Promise<UpstreamResult> {
  const url = new URL(config.upstreamBaseUrl + options.path);
  if (options.query !== undefined) {
    for (const [key, value] of options.query.entries()) url.searchParams.append(key, value);
  }
  assertSafeUpstreamUrl(url);

  const headers: Record<string, string> = { Accept: "application/json", ...options.headers };
  if (config.upstreamApiKey !== undefined) headers["Authorization"] = \`Bearer \${config.upstreamApiKey}\`;
  if (options.body !== undefined) headers["Content-Type"] = "application/json";

  const response = await fetch(url, {
    method: options.method,
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    signal: AbortSignal.timeout(15_000),
  });

  // قراءة متدفقة بسقف بايتات — تجاوز السقف يقطع القراء فوراً
  // ويعيد 413 دون أن يمر الجسم كاملاً عبر الذاكرة قط.
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return { status: 502, ok: false, body: { error: "upstream_body_unreadable" } };
  }
  let received = 0;
  const chunks: Uint8Array[] = [];
  let tooLarge = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value === undefined) continue;
    received += value.byteLength;
    if (received > MAX_BODY_BYTES) { tooLarge = true; void reader.cancel(); break; }
    chunks.push(value);
  }
  if (tooLarge) {
    return { status: 413, ok: false, body: { error: "payload_too_large" } };
  }
  const decoder = new TextDecoder();
  let rawText = "";
  for (const chunk of chunks) rawText += decoder.decode(chunk, { stream: true });
  rawText += decoder.decode();
  let parsedBody: unknown = rawText;
  try {
    parsedBody = JSON.parse(rawText) as unknown;
  } catch {
    // ليس JSON؟ نمرر النص كما هو — القرار للأداة المستهلكة
  }
  return { status: response.status, ok: response.ok, body: parsedBody };
}

/** رسالة خطأ منظفة آمنة للتسليم — بلا أي محتوى من الاستجابة */
export function describeUpstreamFailure(result: UpstreamResult): string {
  return \`فشل نداء الـAPI الأصلي بحالة HTTP \${result.status}\`;
}
`;
}
