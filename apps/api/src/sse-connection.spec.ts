/**
 * اختبارات اتصال SSE المنظم وحصة الاتصالات.
 * ساعة ومصير محقون — حتمي كامل بلا انتظار حقيقي ولا حمل شبكة.
 */

import { describe, expect, it } from "vitest";
import { SSE_MAX_CONNECTIONS_PER_TENANT, SseConnection, SseTenantConnectionQuota } from "./run-service/sse-connection.js";

/** مصير يجمع الكتابات ويتحكم في امتلاء المخزن يدوياً */
class FakeSink {
  public readonly chunks: string[] = [];
  public ended = false;
  public destroyed = false;
  public acceptWrites = true;
  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return this.acceptWrites;
  }
  end(): void {
    this.ended = true;
  }
}

/** مؤقتات مضبوطة يدوياً — لا زمن حقيقي */
function manualTimers() {
  const timers: Array<() => void> = [];
  const setIntervalFn = ((fn: () => void) => {
    timers.push(fn);
    return timers.length - 1;
  }) as unknown as typeof setInterval;
  const clearIntervalFn = (() => undefined) as unknown as typeof clearInterval;
  return { timers, setIntervalFn, clearIntervalFn };
}

describe("SseConnection", () => {
  it("كل حدث يكتب بسطرَي id+data — id هو at (المؤشر)", () => {
    const sink = new FakeSink();
    const connection = new SseConnection(sink);
    connection.sendEvent({ at: "2030-01-18T10:00:01.000Z", summary: "حدث" });
    expect(sink.chunks[0]).toBe("id: 2030-01-18T10:00:01.000Z\ndata: " + JSON.stringify({ at: "2030-01-18T10:00:01.000Z", summary: "حدث" }) + "\n\n");
  });

  it("heartbeat دوري يكتب تعليقاً لا حدثاً — ولا يبقى مؤقتاً بعد الإغلاق", () => {
    const sink = new FakeSink();
    const { timers, setIntervalFn, clearIntervalFn } = manualTimers();
    const connection = new SseConnection(sink, { setIntervalFn, clearIntervalFn });
    expect(timers.length).toBe(1);
    timers[0]?.();
    expect(sink.chunks[0]).toBe(": ping\n\n");
    connection.close();
    expect(sink.ended).toBe(true);
    const chunksAfter = sink.chunks.length;
    timers[0]?.(); // مؤقت مبطل عملياً بعد الإغلاق — لا كتابة إضافية
    expect(sink.chunks.length).toBe(chunksAfter);
  });

  it("إعادة التشغيل بمؤشر Last-Event-ID لا تعيد الأحداث الأقدم منه", () => {
    const sink = new FakeSink();
    const connection = new SseConnection(sink);
    const replayed = [
      { at: "2030-01-18T10:00:01.000Z", summary: "أ" },
      { at: "2030-01-18T10:00:02.000Z", summary: "ب" },
      { at: "2030-01-18T10:00:03.000Z", summary: "ج" },
    ];
    connection.replay(replayed, "2030-01-18T10:00:02.000Z");
    // الأول والأوسط سلفاً وصلوا العميل — الجديد فقط يُعاد
    expect(sink.chunks.length).toBe(1);
    expect(sink.chunks[0]).toContain("10:00:03");
    // بلا مؤشر: كل الأحداث تعاد
    const full = new FakeSink();
    new SseConnection(full).replay(replayed);
    expect(full.chunks.length).toBe(3);
  });

  it("العميل البطيء (مخزن ممتلئ متكرر) يُفصل بعد الحد المعلن — يستأنف بمؤشره", () => {
    const sink = new FakeSink();
    sink.acceptWrites = false; // مخزن ممتلئ دائماً
    const connection = new SseConnection(sink, { maxFullBufferWrites: 3 });
    connection.sendEvent({ at: "1", summary: "أ" });
    connection.sendEvent({ at: "2", summary: "ب" });
    expect(sink.ended).toBe(false); // تحت الحد: صبر
    connection.sendEvent({ at: "3", summary: "ج" });
    expect(sink.ended).toBe(true); // بلغ الحد: فصل مغلق — العميل يعود بآخر id
    expect(connection.isClosed).toBe(true);
  });

  it("الكتابة الناجحة تصفر عدّاد الامتلاء — تقطّع عرضي لا يفصل", () => {
    const sink = new FakeSink();
    const connection = new SseConnection(sink, { maxFullBufferWrites: 3 });
    sink.acceptWrites = false;
    connection.sendEvent({ at: "1", summary: "أ" });
    connection.sendEvent({ at: "2", summary: "ب" });
    sink.acceptWrites = true;
    connection.sendEvent({ at: "3", summary: "ج" }); // نجاح يصفر العدّاد
    sink.acceptWrites = false;
    connection.sendEvent({ at: "4", summary: "د" });
    connection.sendEvent({ at: "5", summary: "هـ" });
    expect(sink.ended).toBe(false);
  });
});

describe("حصة اتصالات المستأجر", () => {
  it("تحجز وتحرر — والبلوغ للسقف يرفض مقعداً جديداً", () => {
    const quota = new SseTenantConnectionQuota();
    const seats: boolean[] = [];
    for (let i = 0; i < SSE_MAX_CONNECTIONS_PER_TENANT; i += 1) seats.push(quota.acquire("t1"));
    expect(seats.every(Boolean)).toBe(true);
    expect(quota.acquire("t1")).toBe(false); // السقف بلغ
    expect(quota.acquire("t2")).toBe(true); // مستأجر آخر معزول بحصته
    quota.release("t1");
    expect(quota.acquire("t1")).toBe(true); // تحرر مقعد فامتلأ مكان
    expect(quota.countOf("t1")).toBe(SSE_MAX_CONNECTIONS_PER_TENANT);
  });
});
