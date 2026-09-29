/**
 * عميل SSE نقي — يستهلك بث text/event-stream بلا polling.
 *
 * ماهيته: لفّ fetch+ReadableStream كـ EventSource مع إعادة اتصال أسية؛ يفسر
 * أسطر data: JSON إلى PipelineEvent ويستخدم session cookie فقط.
 * وظيفته: يغذي صفحة التشغيل بأحداث حية؛ يعيد المحاولة أسى عند انقطاع.
 * كيف: parseSseEvent تفصل حقل data، والمصنع fetchSseEvents يقرأ الدفق سطراً
 * سطراً ويعيد الاشتراك عند الفشل حتى الوصول لحالة نهائية.
 */

// يفسر كتلة SSE واحدة إلى JSON — خالصة قابلة للاختبار
export function parseSseEvent(block: string): unknown | null {
  const lines = block.split("\n");
  const dataLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    else if (line.trim() === "") continue;
  }
  if (dataLines.length === 0) return null;
  const json = dataLines.join("\n");
  try {
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

export interface SseOptions {
  readonly headers?: Record<string, string>;
  readonly signal?: AbortSignal;
}

// يقرأ بث SSE عبر fetch ويستدعي onEvent لكل كائن — يعيد إلغاء الاشتراك
export function subscribeSse(
  url: string,
  options: SseOptions,
  handlers: { onEvent: (event: unknown) => void; onError?: (error: Error) => void; onDone?: () => void },
): () => void {
  const controller = new AbortController();
  const signal = options.signal ?? controller.signal;
  let cancelled = false;
  let attempt = 0;

  async function connect(): Promise<void> {
    if (cancelled) return;
    try {
      const response = await fetch(url, { headers: options.headers, signal, cache: "no-store", credentials: "include" });
      if (!response.ok || response.body === null) throw new Error(`HTTP ${response.status}`);
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      attempt = 0;
      while (!cancelled) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          const parsed = parseSseEvent(part);
          if (parsed !== null) handlers.onEvent(parsed);
        }
      }
      // دفق انتهى بشكل طبيعي — إغلاق
      if (!cancelled) handlers.onDone?.();
    } catch (error: unknown) {
      if (cancelled || (signal.aborted)) return;
      const delay = Math.min(1000 * 2 ** attempt, 8000) + Math.floor(Math.random() * 200);
      attempt += 1;
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
      if (!cancelled) void connect();
    }
  }

  void connect();
  return () => {
    cancelled = true;
    controller.abort();
  };
}
