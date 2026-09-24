"use client";

import { useEffect, useRef, type ReactNode } from "react";
import FocusTrap from "focus-trap-react";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  /**
   * "end" → slides in from the inline-end edge (right in LTR, left in RTL).
   * "center" → traditional modal anchored in the middle of the viewport.
   */
  placement?: "end" | "center";
  /**
   * Tailwind width class. Each placement keeps its own default when omitted —
   * `w-full sm:w-[480px]` for a drawer, `w-[min(480px,90vw)]` for a modal — so
   * passing nothing behaves exactly as before. Set it when a modal has to hold
   * something wider than a form, such as a table.
   */
  width?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Disable focus trap when host already handles it (rare). */
  trapFocus?: boolean;
  children: ReactNode;
}

/**
 * Side-drawer + center-modal primitive. Replaces ad-hoc modal patterns
 * scattered across the panel + carrier picker + reopen confirm + Dexpress
 * dispatch modal. Overlay z-40, panel z-50, ESC closes, outside click closes,
 * focus traps inside, body scroll-locked while open.
 */
export function Sheet({
  open,
  onClose,
  placement = "end",
  width,
  ariaLabel,
  ariaLabelledBy,
  trapFocus = true,
  children,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  const panelClass =
    placement === "end"
      ? [
          "fixed top-0 end-0 h-full z-50 flex flex-col overflow-hidden",
          "bg-surface-card border-s border-line-subtle shadow-panel",
          "animate-[slideInEnd_180ms_ease-out]",
          width ?? "w-full sm:w-[480px]",
        ].join(" ")
      : [
          "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
          "max-h-[90vh] flex flex-col overflow-hidden",
          // The base width always stays, and `width` layers on top of it. Five
          // center dialogs were already passing a `sm:w-[…]` that this branch
          // ignored; applying it bare would leave them with no width at all
          // below the sm breakpoint, so it has to be an override, not a
          // replacement.
          "w-[min(480px,90vw)]",
          width ?? "",
          "rounded-card bg-surface-card border border-line-subtle shadow-floating",
        ].join(" ");

  const body = (
    <>
      <div
        className="fixed inset-0 z-40 bg-ink-primary/40"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabelledBy ? undefined : ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={panelClass}
      >
        {children}
      </div>
    </>
  );

  if (!trapFocus) return body;

  return (
    <FocusTrap
      focusTrapOptions={{
        allowOutsideClick: true,
        escapeDeactivates: false,
        fallbackFocus: () => panelRef.current ?? document.body,
      }}
    >
      <div>{body}</div>
    </FocusTrap>
  );
}
