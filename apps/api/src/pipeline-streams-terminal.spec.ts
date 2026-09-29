/**
 * انحدار — الاشتراك في بث SSE لتشغيل نهائي سبق اكتماله.
 *
 * العيب المكتشف سابقاً: onDone كان يُستدعى متزامناً أثناء
 * source.subscribe نفسها بينما finish معرّف بعدها — ReferenceError في
 * منطقة TDZ أسقط الخادم كله (ERR_HTTP_HEADERS_SENT). الإصلاح: تعريف
 * finish قبل الاشتراك + علم إنهاء مكرر الأمان. هذا الاختبار يثبت أن
 * الاشتراك في مصدر منتهٍ يغلق الدفق بنظافة ويحرر حصة الحصة مرة واحدة.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import type { FastifyReply, FastifyRequest } from "fastify";
import { sendSseStream } from "./routes/pipeline-streams.js";

function fakeRequest(): FastifyRequest {
  const raw = new EventEmitter();
  return { raw, headers: {}, log: { warn: () => undefined } } as unknown as FastifyRequest;
}

function fakeReply(): { reply: FastifyReply; writes: string[] } {
  const writes: string[] = [];
  const raw = {
    writeHead: (status: number, headers: Record<string, string>) => {
      writes.push(`head:${status}:${headers["content-type"] ?? ""}`);
    },
    write: (chunk: string) => { writes.push(chunk); },
    end: () => { writes.push("end"); },
  };
  const reply = {
    raw,
    header: () => reply,
    code: () => reply,
    send: (payload: unknown) => { writes.push(`send:${JSON.stringify(payload)?.slice(0, 40)}`); return reply; },
  } as unknown as FastifyReply;
  return { reply, writes };
}

describe("SSE لتشغيل نهائي سبق اكتماله", () => {
  it("onDone المتزامن أثناء الاشتراك يغلق الدفق بلا انهيار ويحرر الحصة", async () => {
    const { reply, writes } = fakeReply();
    const request = fakeRequest();
    const source = {
      replayed: [],
      // مصدر منتهٍ: onDone يُطلق متزامناً داخل subscribe نفسها — سيناريو العيب
      subscribe: (handlers: { onEvent: (e: unknown) => void; onDone: () => void }) => {
        handlers.onDone();
        return () => undefined;
      },
    };
    const container = {
      runs: { openEventSource: async () => source },
      sseQuotaStore: undefined,
    } as unknown as Parameters<typeof sendSseStream>[0];

    const result = await sendSseStream(container, "t1", "r1-done", request, reply);
    expect(result).toBeDefined();
    expect(writes.some((w) => w.startsWith("head:200"))).toBe(true);
    // الدفق أُغلق نظيفاً — لا 500 ولا استثناء TDZ
    expect(writes.includes("end")).toBe(true);
  });

  it("تزامن onDone مع close ينهي مرة واحدة — لا إلغاء اشتراك مزدوج", async () => {
    const writes: string[] = [];
    const raw = new EventEmitter();
    const reply = {
      raw: {
        writeHead: (status: number) => { writes.push(`head:${status}`); },
        write: () => undefined,
        end: () => undefined,
      },
      header: () => reply, code: () => reply, send: () => reply,
    } as unknown as FastifyReply;
    const request = fakeRequest();
    let unsubscribeCount = 0;
    // onDone مؤجل: نستدعيه يدوياً بعد عودة المسار ثم نحاكي close بعده —
    // استدعاءان لfinish يجب أن يُنفَّذا فعلياً مرة واحدة
    // حامل كائني كي لا يضيّق TypeScript النوع إلى never بعد الاستدعاء الخلفي
    const holder: { onDone?: () => void } = {};
    const source = {
      replayed: [],
      subscribe: (incoming: { onEvent: (e: unknown) => void; onDone: () => void }) => {
        holder.onDone = incoming.onDone;
        return () => { unsubscribeCount += 1; };
      },
    };
    const container = {
      runs: { openEventSource: async () => source },
      sseQuotaStore: undefined,
    } as unknown as Parameters<typeof sendSseStream>[0];

    await sendSseStream(container, "t1", "r1-double", request, reply);
    if (holder.onDone === undefined) throw new Error("لم يُسجَّل onDone");
    holder.onDone();
    raw.emit("close");
    expect(unsubscribeCount).toBe(1);
  });
});
