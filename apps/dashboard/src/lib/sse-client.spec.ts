/**
 * اختبارات عميل SSE النقي — منطق خالص بلا شبكة.
 */

import { describe, it, expect, vi } from "vitest";
import { parseSseEvent, subscribeSse } from "./sse-client";

describe("parseSseEvent", () => {
  it("يفسر كتلة data واحدة إلى JSON", () => {
    const block = `data: {"stage":"load_spec","summary":"مرحبا"}\n\n`;
    expect(parseSseEvent(block)).toEqual({ stage: "load_spec", summary: "مرحبا" });
  });

  it("يجمع أسطر data متعددة", () => {
    const block = `data: {"a":1}\ndata: {"b":2}\n\n`;
    // السطران يُجمعان بسطر جديد — JSON غير صالح فيُعاد null
    expect(parseSseEvent(block)).toBeNull();
  });

  it("كتلة فارغة → null", () => {
    expect(parseSseEvent("")).toBeNull();
    expect(parseSseEvent("\n\n")).toBeNull();
  });

  it("JSON فاسد → null", () => {
    expect(parseSseEvent("data: {not json}\n\n")).toBeNull();
  });

  it("يتجاهل حقول event وid ويأخذ data فقط", () => {
    const block = `id: 1\nevent: update\ndata: {"ok":true}\n\n`;
    expect(parseSseEvent(block)).toEqual({ ok: true });
  });
});

describe("subscribeSse", () => {
  it("يستقبل حدثاً واحداً عبر fetch مزيف", async () => {
    const originalFetch = globalThis.fetch;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`data: {"hello":"world"}\n\n`));
        controller.close();
      },
    });
    globalThis.fetch = vi.fn(async () => ({ ok: true, body: stream }) as unknown as Response);
    const events: unknown[] = [];
    const done = vi.fn();
    const unsub = subscribeSse("http://test/stream", {}, { onEvent: (e) => events.push(e), onDone: done });
    await new Promise((r) => setTimeout(r, 50));
    unsub();
    globalThis.fetch = originalFetch;
    expect(events).toEqual([{ hello: "world" }]);
  });
});
