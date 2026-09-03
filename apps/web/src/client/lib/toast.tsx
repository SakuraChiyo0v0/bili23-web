import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

export type ToastTone = "ok" | "err" | "warn" | "info";
export interface ToastItem {
  id: number;
  msg: string;
  tone: ToastTone;
}

interface ToastCtx {
  toasts: ToastItem[];
  toast: (msg: string, tone?: ToastTone) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (msg: string, tone: ToastTone = "ok") => {
      const id = ++seq.current;
      setToasts((cur) => [...cur.slice(-3), { id, msg, tone }]);
      window.setTimeout(() => dismiss(id), 2600);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ toasts, toast }), [toasts, toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toast-root" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            <span className="toast-dot" />
            <span>{t.msg}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
