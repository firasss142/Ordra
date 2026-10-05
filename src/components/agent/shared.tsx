"use client";

// The agent shell's small shared pieces (prototypes/agent-shell-v2.html): the phone switch,
// the pill in any of the prototype's hues, and the toast with its 5-second « Annuler ».
// Icons, thumbs, the tooltip and the time words are Commandes' (components/orders/commandes/ui).

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useMediaQuery, PHONE_QUERY } from "@/hooks/useMediaQuery";
import { Ic } from "@/components/orders/commandes/ui";

export { Ic, Thumb, useTip, useWhen, Avatar } from "@/components/orders/commandes/ui";

/** The prototype's hue families (`.h-*` in agent.css). */
export type AgentHue = "neutral" | "amber" | "violet" | "teal" | "green" | "red" | "blue" | "pink" | "gold";

/** The prototype's « Téléphone » format — below 768 px the pages draw their phone markup. */
export function useAgentPhone(): boolean {
  return useMediaQuery(PHONE_QUERY);
}

/** `pill(hue, icon, text, tip)` — a status says its word. */
export function APill({ hue, icon, text, tip }: { hue: AgentHue; icon: string; text: ReactNode; tip?: string }) {
  return (
    <span className={`pl h-${hue}`} data-tip={tip}>
      <Ic n={icon} />
      <span>{text}</span>
    </span>
  );
}

/** `tagHTML` — a tag says its number, in words. */
export function ATag({ hue, icon, text, tip }: { hue: AgentHue; icon: string; text: ReactNode; tip?: string }) {
  return (
    <span className={`tg h-${hue}`} data-tip={tip}>
      <Ic n={icon} />
      {text}
    </span>
  );
}

// ── the toast — the live app's 5-second « Annuler » (prototype `toast`) ─────────────────────

interface ToastState {
  id: number;
  msg: string;
  undo: (() => void) | null;
}
type ShowToast = (msg: string, undo?: () => void) => void;

const ToastCtx = createContext<ShowToast>(() => {});

/** Show a toast; pass `undo` for the 5-second « Annuler » with its shrinking bar. */
export function useAgentToast(): ShowToast {
  return useContext(ToastCtx);
}

export function AgentToastProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("agent");
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  const show = useCallback<ShowToast>((msg, undo) => {
    if (timer.current) clearTimeout(timer.current);
    const id = ++seq.current;
    setToast({ id, msg, undo: undo ?? null });
    timer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), undo ? 5000 : 2800);
  }, []);

  const value = useMemo(() => show, [show]);

  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className={`tip toast${toast ? " on" : ""}`} role="status" aria-live="polite">
        {toast ? (
          <>
            <span>{toast.msg}</span>
            {toast.undo ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    toast.undo?.();
                    setToast(null);
                  }}
                >
                  {t("undo")}
                </button>
                <i key={toast.id} className="bar5" />
              </>
            ) : null}
          </>
        ) : null}
      </div>
    </ToastCtx.Provider>
  );
}
