/**
 * اختبارات حاجز انهيار Redis — انقطاع البتة لا يُسقط العملية:
 * يجب أن يسجل connectOnDemand معالج 'error' على العميل فوراً، وأن
 * يستدعاء المعالج بخطأ مقبس يبقى صامتاً (سجل تحذيري فقط بلا استثناء).
 */
import { describe, expect, it } from "vitest";
import { connectOnDemand } from "./container/redis-connector.js";

/** عميل مزيّف يلتقط مستمعي الأحداث بلا أي اتصال حقيقي */
function fakeClient() {
  const listeners = new Map<string, Array<(error: Error) => void>>();
  const fake = {
    on(event: string, handler: (error: Error) => void) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return fake;
    },
    connect: async () => fake,
    quit: async () => "OK",
    emitError(event: string, error: Error) {
      for (const handler of listeners.get(event) ?? []) handler(error);
    },
    listenerCount(event: string) {
      return (listeners.get(event) ?? []).length;
    },
  };
  return fake as unknown as Parameters<typeof connectOnDemand>[0] & {
    emitError(event: string, error: Error): void;
    listenerCount(event: string): number;
  };
}

describe("حاجز انهيار اتصال Redis", () => {
  it("يسجل معالج error فوراً — لا حدث غير معالج يُسقط العملية", () => {
    const client = fakeClient();
    connectOnDemand(client);
    expect(client.listenerCount("error")).toBeGreaterThanOrEqual(1);
  });

  it("استدعاء معالج error بخطأ مقبس لا يرمي — السلوك سجل فقط", () => {
    const client = fakeClient();
    connectOnDemand(client);
    expect(() => client.emitError("error", new Error("Socket closed unexpectedly"))).not.toThrow();
  });

  it("المعالج لا يطبع أي شيء من قيمة url أو أسرار الاتصال", () => {
    const client = fakeClient();
    connectOnDemand(client);
    const written: string[] = [];
    const originalWarn = console.warn;
    console.warn = (value: unknown) => {
      written.push(String(value));
    };
    try {
      client.emitError("error", new Error("Connection refused: redis://:secret@127.0.0.1:1/0"));
    } finally {
      console.warn = originalWarn;
    }
    expect(written).toHaveLength(1);
    expect(written[0]).not.toContain("secret");
    expect(written[0]).toContain("redis_connection_error");
  });
});
