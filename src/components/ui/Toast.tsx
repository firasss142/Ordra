"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

export type ToastTone = "info" | "warning" | "critical";

interface ToastInput {
  tone?: ToastTone;
  message: string;
  duration?: number;
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastContextValue {
  show: (input: ToastInput) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside a <ToastProvider>");
  return ctx;
}

const TONE_STYLES: Record<ToastTone, { accent: string; role: "status" | "alert" }> = {
  info: { accent: "bg-status-action", role: "status" },
  warning: { accent: "bg-status-warning", role: "status" },
  critical: { accent: "bg-status-critical", role: "alert" },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = ++idRef.current;
      const duration = input.duration ?? 5000;
      setToasts((prev) => [...prev, { ...input, id }]);
      const timer = setTimeout(() => dismiss(id), duration);
      timersRef.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setToasts((prev) => {
          if (prev.length === 0) return prev;
          // Dismiss all open toasts on Escape — simplest UX
          for (const t of prev) {
            const timer = timersRef.current.get(t.id);
            if (timer) clearTimeout(timer);
            timersRef.current.delete(t.id);
          }
          return [];
        });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    return () => {
      for (const t of timersRef.current.values()) clearTimeout(t);
      timersRef.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[200] flex flex-col items-center gap-2">
        {toasts.map((t) => {
          const style = TONE_STYLES[t.tone ?? "info"];
          return (
            <div
              key={t.id}
              role={style.role}
              aria-live={style.role === "alert" ? "assertive" : "polite"}
              className="pointer-events-auto flex max-w-[420px] overflow-hidden rounded-lg bg-surface-ink text-white shadow-lg"
            >
              <span aria-hidden="true" className={`w-1 ${style.accent}`} />
              <div className="flex items-center gap-3 px-4 py-3 text-[13px]">
                <span>{t.message}</span>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss"
                  className="ml-2 inline-flex h-5 w-5 items-center justify-center rounded text-white/60 transition-colors hover:text-white"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
