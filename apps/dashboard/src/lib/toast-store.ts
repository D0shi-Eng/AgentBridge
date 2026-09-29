/**
 * مخزن التنبيهات النقي — نشر/إزالة/انقضاء تلقائي بمجدول قابل للحقن.
 * المنطق هنا كله ليُختبر دون DOM؛ ToastProvider في components/ui غلاف رقيق
 * يربطه بـuseSyncExternalStore.
 *
 * قاعدة الوصولية : الخطأ لا ينقضي تلقائياً إطلاقاً — يبقى حتى
 * يقرأه المستخدم ويغلق بنفسه؛ النجاح والمعلومة ينقضيان بعد المهلة.
 */

export type ToastKind = "success" | "error" | "info";

export interface ToastItem {
  readonly id: number;
  readonly kind: ToastKind;
  readonly message: string;
}

/** مجدول زمني قابل للحقن — الافتراضي setTimeout والاختبارات تستبدله يدوياً */
export interface ToastScheduler {
  schedule(fn: () => void, afterMs: number): void;
}

export interface ToastStoreOptions {
  /** عمر التنبيهات العابرة (نجاح/معلومة) قبل الانقضاء التلقائي */
  readonly timeoutMs?: number;
  readonly scheduler?: ToastScheduler;
}

export interface ToastStore {
  subscribe(listener: () => void): () => void;
  snapshot(): readonly ToastItem[];
  push(kind: ToastKind, message: string): number;
  dismiss(id: number): void;
}

const DEFAULT_TIMEOUT_MS = 4200;

/** مهلة كل نوع — null تعني بلا انقضاء تلقائي (يبقى حتى الإغلاق اليدوي) */
const KIND_TIMEOUT: Record<ToastKind, number | null> = {
  success: DEFAULT_TIMEOUT_MS,
  info: DEFAULT_TIMEOUT_MS,
  error: null,
};

/** يبني مخزناً حتمياً: معرفات تسلسلية، إشعار للمشتركين عند كل تغيير */
export function createToastStore(options: ToastStoreOptions = {}): ToastStore {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scheduler: ToastScheduler =
    options.scheduler ??
    {
      schedule(fn, ms) {
        setTimeout(fn, ms);
      },
    };

  const listeners = new Set<() => void>();
  let items: readonly ToastItem[] = [];
  let nextId = 1;

  function emit(): void {
    for (const listener of [...listeners]) listener();
  }

  function remove(id: number): void {
    if (!items.some((item) => item.id === id)) return;
    items = items.filter((item) => item.id !== id);
    emit();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot() {
      return items;
    },
    push(kind, message) {
      const id = nextId;
      nextId += 1;
      items = [...items, { id, kind, message }];
      const kindTimeout = KIND_TIMEOUT[kind];
      if (kindTimeout !== null) scheduler.schedule(() => remove(id), timeoutMs);
      emit();
      return id;
    },
    dismiss(id) {
      remove(id);
    },
  };
}
