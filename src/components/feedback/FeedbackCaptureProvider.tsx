"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { useSWRConfig } from "swr";
import { useMarketScope } from "@/context/market-scope";
import { undoFeedback } from "@/hooks/useFeedback";
import { isEditableTarget } from "@/lib/dom";
import { canCaptureFeedback } from "@/lib/role-permissions";
import type { Role } from "@/types";
import { CaptureDialog, type SavedFeedback } from "./CaptureDialog";

interface FeedbackCaptureValue {
  /** This role can capture (agents, managers, super_admin) and a provider is mounted. */
  enabled: boolean;
  /** The window is up — the queue's and the panel's own keys stand down while it is. */
  captureOpen: boolean;
  /** Open on the registered order, or on `orderId` when given (null = the callback search). */
  openCapture: (orderId?: string | null) => void;
  register: (orderId: string) => () => void;
}

const NOOP: FeedbackCaptureValue = { enabled: false, captureOpen: false, openCapture: () => {}, register: () => () => {} };
const Ctx = createContext<FeedbackCaptureValue>(NOOP);

export const useFeedbackCapture = () => useContext(Ctx);

/**
 * The order on screen becomes the capture context. The order panel calls this once — the
 * first of its three additions (plan, « The order panel is not redesigned »).
 */
export function useRegisterFeedbackContext(orderId: string | null | undefined) {
  const ctx = useContext(Ctx);
  const { register } = ctx;
  useEffect(() => (orderId ? register(orderId) : undefined), [orderId, register]);
  return ctx;
}

/** The shell's « Annuler » lasts 5 s (prototype `toast`, the shrinking `.bar5`). */
const TOAST_MS = 5_000;

/**
 * « Voix du client » capture, mounted once in both dashboard shells (agent and manager).
 *
 * F — matched on `e.code === "KeyF"`, so it works on the Arabic layout where that key types
 * « ب » — opens the window outside text fields and never on top of another dialog. With an
 * order registered (the panel, a selected parcel) it opens linked to it; otherwise on the
 * inbound-callback search. After a save, the toast « Enregistré · Annuler » undoes it.
 *
 * The window and its toast are drawn in the agent shell's language (prototypes/agent-shell-v2,
 * `captureHTML` + `toast`): both live in a portal layer `.agt.agt-layer`, so they carry the
 * shell's styles whatever wraps this provider.
 */
export function FeedbackCaptureProvider({ role, children }: { role: Role; children: ReactNode }) {
  const enabled = canCaptureFeedback(role);
  const scope = useMarketScope();
  const market = role === "super_admin" ? scope.marketId : null;
  const { mutate } = useSWRConfig();
  const t = useTranslations("agentVoc");
  const locale = useLocale();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const registered = useRef<string[]>([]);
  const [open, setOpen] = useState<{ orderId: string | null } | null>(null);
  const [toast, setToast] = useState<SavedFeedback | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const register = useCallback((orderId: string) => {
    registered.current = [...registered.current, orderId];
    return () => {
      const i = registered.current.lastIndexOf(orderId);
      if (i >= 0) registered.current = registered.current.filter((_, k) => k !== i);
    };
  }, []);

  const openCapture = useCallback((orderId?: string | null) => {
    if (!enabled) return;
    const current = registered.current[registered.current.length - 1] ?? null;
    setOpen({ orderId: orderId === undefined ? current : orderId });
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "KeyF" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isEditableTarget(e.target) || open) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      e.preventDefault();
      openCapture();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [enabled, open, openCapture]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const refresh = useCallback(() => {
    void mutate((key) => typeof key === "string" && key.startsWith("/api/feedback"), undefined, { revalidate: true });
  }, [mutate]);

  const onSaved = useCallback((saved: SavedFeedback) => {
    setOpen(null);
    setToast(saved);
    refresh();
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, [refresh]);

  const undo = useCallback(async () => {
    if (!toast) return;
    const id = toast.id;
    setToast(null);
    try {
      await undoFeedback(id);
    } finally {
      refresh();
    }
  }, [toast, refresh]);

  const value = useMemo<FeedbackCaptureValue>(
    () => (enabled ? { enabled: true, captureOpen: open !== null, openCapture, register } : NOOP),
    [enabled, open, openCapture, register],
  );

  const toastText = toast
    ? [t("capture.saved"), t(`cat.${toast.category}`), toast.topic, t(`moment.${toast.moment}`)].filter(Boolean).join(" · ")
    : "";

  const layer = (open || toast) && mounted ? createPortal(
    <div className="agt agt-layer" dir={locale === "ar" ? "rtl" : "ltr"} lang={locale}>
      {open && (
        <CaptureDialog orderId={open.orderId} market={market} onClose={() => setOpen(null)} onSaved={onSaved} />
      )}
      {toast && (
        <div className="tip toast on" role="status" aria-live="polite">
          <span>{toastText}</span>
          <button type="button" onClick={() => void undo()}>{t("capture.undo")}</button>
          <i key={toast.id} className="bar5" />
        </div>
      )}
    </div>,
    document.body,
  ) : null;

  return (
    <Ctx.Provider value={value}>
      {children}
      {layer}
    </Ctx.Provider>
  );
}
