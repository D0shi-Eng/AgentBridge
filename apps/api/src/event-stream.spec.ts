/**
 * اختبار بث NDJSON — إعادة تاريخية ثم بث حي ثم إغلاق، حتمياً بلا توقيت.
 */
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type { PipelineEvent } from "@agentbridge/shared";
import { LiveNdjsonStream, type EventStreamSource } from "./event-stream.js";

function event(sequence: number): PipelineEvent {
  return {
    runId: "r1",
    tenantId: "t1",
    stage: "harden",
    at: `2026-08-24T00:00:0${sequence}Z`,
    summary: `حدث ${sequence}`,
  };
}

/** يجمع كل الدفق حتى الإغلاق ويعيد الأسطر */
async function drain(stream: LiveNdjsonStream): Promise<string[]> {
  const chunks: string[] = [];
  for await (const chunk of stream) chunks.push(String(chunk));
  return chunks.join("").split("\n").filter((line) => line.length > 0);
}

describe("LiveNdjsonStream", () => {
  it("يعيد الأحداث التاريخية ثم يغلق فوراً لمصدر منتهٍ", async () => {
    const source: EventStreamSource = {
      replayed: [event(1), event(2)],
      // نمذجة مصدر منتهٍ — كما يفعل buildSource لتشغيل بلا handle حي
      subscribe: (handlers) => {
        handlers.onDone();
        return () => undefined;
      },
    };
    const lines = await drain(new LiveNdjsonStream(source));
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ summary: "حدث 1" });
  });

  it("يبث الأحداث اللاحقة لحظة وقوعها ويغلق عند onDone", async () => {
    let listeners: { onEvent: (e: PipelineEvent) => void; onDone: () => void } | null = null;
    const source: EventStreamSource = {
      replayed: [event(1)],
      subscribe: (handlers) => {
        listeners = handlers;
        return () => {
          listeners = null;
        };
      },
    };

    const stream = new LiveNdjsonStream(source);
    const collected = drain(stream);

    // بعد انفتاح الدفق نبث حدثين جديدين ثم النهاية
    setImmediate(() => {
      const active = listeners;
      if (active) {
        active.onEvent(event(2));
        active.onEvent(event(3));
        active.onDone();
      }
    });

    const lines = await collected;
    expect(lines.map((line) => JSON.parse(line).summary as string)).toEqual(["حدث 1", "حدث 2", "حدث 3"]);
  });

  it("الاشتراك يُلغى عند تدمير الدفق مبكراً (لا مستمعون يتامى)", async () => {
    let unsubscribed = false;
    const source: EventStreamSource = {
      replayed: [],
      subscribe: () => () => {
        unsubscribed = true;
      },
    };

    const stream = new LiveNdjsonStream(source);
    stream.destroy();
    await new Promise((resolve) => stream.on("close", resolve));
    expect(unsubscribed).toBe(true);
  });

  it("مصدر بلا مشتركين نهائياً يعمل كإعادة صرفة (Readable متوافق)", async () => {
    const pureReplay = new LiveNdjsonStream({
      replayed: [],
      subscribe: (handlers) => {
        handlers.onDone();
        return () => undefined;
      },
    });
    expect(pureReplay instanceof Readable).toBe(true);
    const lines = await drain(pureReplay);
    expect(lines).toHaveLength(0);
  });
});
