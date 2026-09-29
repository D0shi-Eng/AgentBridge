"use client";

/**
 * مزود التنبيهات — غلاف React رقيق فوق مخزن toast-store النقي المختبر.
 * المنفذ : الحاوية منطقة حية aria-live، الخطأ role=alert ولا ينقضي
 * تلقائياً، وكل تنبيه بزر إغلاق حقيقي قابل للوحة المفاتيح — لا نقر على div.
 */

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import { createToastStore, type ToastKind, type ToastStore } from "@/lib/toast-store";
import { t, useLocale } from "@/lib/i18n";

const StoreContext = createContext<ToastStore | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => createToastStore(), []);
  return (
    <StoreContext.Provider value={store}>
      {children}
      <ToastViewport store={store} />
    </StoreContext.Provider>
  );
}

/** خطاف النشر: toast.success("…") / toast.error("…") / toast.info("…") */
export function useToast(): {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
} {
  const store = useContext(StoreContext);
  if (store === null) throw new Error("useToast خارج ToastProvider");
  return useMemo(
    () => ({
      success: (message) => void store.push("success", message),
      error: (message) => void store.push("error", message),
      info: (message) => void store.push("info", message),
    }),
    [store],
  );
}

function ToastViewport({ store }: { store: ToastStore }) {
  const { locale } = useLocale();
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store]);
  const items = useSyncExternalStore(subscribe, store.snapshot, store.snapshot);
  return (
    // منطقة حية واحدة تقرأ الإضافات؛ الخطأ الحرج يحمل role=alert على نفسه
    <div className="toast-stack" role="log" aria-live="polite" aria-label={t("common.notificationsArea", locale)}>
      {items.map((item) => (
        <div
          key={item.id}
          className={`toast ${item.kind}`}
          role={item.kind === "error" ? "alert" : "status"}
        >
          <span className="toast-message">{item.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label={t("common.dismissToast", locale)}
            title={t("common.dismissToast", locale)}
            onClick={() => store.dismiss(item.id)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export type { ToastKind };
