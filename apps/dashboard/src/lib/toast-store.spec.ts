/**
 * اختبارات مخزن التنبيهات النقي — نشر وانقضاء تلقائي بمجدول يدوي.
 */
import { describe, expect, it } from "vitest";
import { createToastStore, type ToastScheduler } from "./toast-store.js";

/** مجدول يدوي: يحتفظ بالأعمال حتى يستدعيها الاختبار بترتيبها */
function manualScheduler(): ToastScheduler & { flush(): void } {
  const queue: Array<() => void> = [];
  return {
    schedule(fn) {
      queue.push(fn);
    },
    flush() {
      while (queue.length > 0) (queue.shift() as () => void)();
    },
  };
}

describe("createToastStore", () => {
  it("النشر يضيف بمعرف تسلسلي ويشعر المشتركين", () => {
    const store = createToastStore({ scheduler: manualScheduler() });
    const seen: number[] = [];
    store.subscribe(() => seen.push(store.snapshot().length));
    const id = store.push("success", "تم الحفظ");
    expect(id).toBe(1);
    expect(store.snapshot()).toEqual([{ id: 1, kind: "success", message: "تم الحفظ" }]);
    expect(seen).toEqual([1]);
  });

  it("المعرفات تتصاعد حتى بعد الإزاحة اليدوية", () => {
    const store = createToastStore({ scheduler: manualScheduler() });
    const first = store.push("error", "أ");
    store.dismiss(first);
    expect(store.snapshot()).toHaveLength(0);
    expect(store.push("info", "ب")).toBe(2);
  });

  it("انقضاء تلقائي بعد المهلة عبر المجدول المحقون", () => {
    const scheduler = manualScheduler();
    const store = createToastStore({ scheduler, timeoutMs: 1000 });
    store.push("success", "سيمضي وحده");
    scheduler.flush();
    expect(store.snapshot()).toHaveLength(0);
  });

  it("إزاحة معرف غير موجود لا تشعر أحداً", () => {
    const store = createToastStore({ scheduler: manualScheduler() });
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.dismiss(99);
    expect(notified).toBe(0);
  });

  it("إلغاء الاشتراك يوقف الإشعار", () => {
    const store = createToastStore({ scheduler: manualScheduler() });
    let notified = 0;
    const unsubscribe = store.subscribe(() => {
      notified += 1;
    });
    unsubscribe();
    store.push("info", "لا يصل");
    expect(notified).toBe(0);
  });
});
