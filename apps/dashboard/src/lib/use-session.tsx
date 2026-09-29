"use client";

/**
 * مزود الجلسة — مصدر حالة الهوية هو الخادم حصراً؛ لا يُقرأ tenant أو مفتاح
 * من Web Storage. صار مزوداً مشتركاً فكل الصفحات والقشرة تقرأ الجلسة نفسها
 * بنداء /auth/session واحد لكل تحميل (كان كل مكوّن يكرر النداء).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiError, type Credentials } from "./api-client";
import { clearLegacyCredentials } from "./storage";

type SessionError = "expired" | "forbidden" | "network" | null;

interface SessionContextValue {
  session: Credentials | null;
  ready: boolean;
  error: SessionError;
  refresh: () => Promise<Credentials | null>;
  replace: (next: Credentials | null) => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const generation = useRef(0);
  const [session, setSession] = useState<Credentials | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<SessionError>(null);

  const refresh = useCallback(async (): Promise<Credentials | null> => {
    const current = ++generation.current;
    try {
      const result = await api.session();
      if (current !== generation.current) return null;
      const next = { tenantId: result.tenantId, permissions: result.permissions };
      setSession(next); setError(null); return next;
    } catch (cause) {
      if (current !== generation.current) return null;
      setSession(null);
      setError(cause instanceof ApiError && cause.status === 401 ? "expired" : cause instanceof ApiError && cause.status === 403 ? "forbidden" : "network");
      return null;
    } finally {
      if (current === generation.current) setReady(true);
    }
  }, []);

  useEffect(() => {
    clearLegacyCredentials();
    void refresh();
    return () => { generation.current += 1; };
  }, [refresh]);

  const replace = useCallback((next: Credentials | null) => {
    generation.current += 1; setSession(next); setError(null); setReady(true);
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({ session, ready, error, refresh, replace }),
    [session, ready, error, refresh, replace],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === null) throw new Error("useSession خارج SessionProvider — غلّف مسارات (app) بالمزود");
  return value;
}
