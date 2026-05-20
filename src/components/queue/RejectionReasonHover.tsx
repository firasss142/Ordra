"use client";

import { useState, useRef, useId, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useTranslations, useLocale } from "next-intl";

interface RejectionReasonHoverProps {
  /** The rejected status pill to wrap. */
  children: React.ReactNode;
  /** Canonical rejection reason key (e.g. "refus_client", "autre"). */
  reason: string | null;
  /** Free-text note — required for "autre", optional otherwise. */
  note: string | null;
}

const POPOVER_WIDTH = 240;
const VIEWPORT_GUTTER = 8;

/**
 * Wraps the rejected status pill and reveals the rejection reason (and any
 * free-text note) in a hover popover. The popover renders through a portal so
 * it escapes the order card's stacking context and is never clipped by sibling
 * cards below it in the queue.
 */
export function RejectionReasonHover({
  children,
  reason,
  note,
}: RejectionReasonHoverProps) {
  const t = useTranslations("orders.rejectionReasons");
  const locale = useLocale();
  const isRtl = locale === "ar";
  const popoverId = useId();

  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerRef = useRef<HTMLSpanElement | null>(null);

  if (!reason) return <>{children}</>;

  const reasonLabel = t(reason as Parameters<typeof t>[0]);
  // For "autre" the note carries the actual reason, so show it instead of the
  // generic "Autre" label; for other reasons append the note when present.
  const text =
    reason === "autre" && note?.trim()
      ? note.trim()
      : note?.trim()
        ? `${reasonLabel} · ${note.trim()}`
        : reasonLabel;

  function handleEnter() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  }
  function handleLeave() {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  return (
    <span
      ref={triggerRef}
      className="relative inline-flex"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onFocus={handleEnter}
      onBlur={handleLeave}
      tabIndex={0}
      aria-describedby={open ? popoverId : undefined}
    >
      {children}
      {open && (
        <RejectionPopover
          id={popoverId}
          anchorRef={triggerRef}
          isRtl={isRtl}
          onMouseEnter={handleEnter}
          onMouseLeave={handleLeave}
          text={text}
        />
      )}
    </span>
  );
}

interface RejectionPopoverProps {
  id: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  isRtl: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  text: string;
}

function RejectionPopover({
  id,
  anchorRef,
  isRtl,
  onMouseEnter,
  onMouseLeave,
  text,
}: RejectionPopoverProps) {
  // The tooltip hugs its content, so we anchor it by the edge nearest the pill
  // and let it grow toward the viewport center: by `right` in LTR, by `left`
  // in RTL. Storing both the inline-edge offset and `top` keeps it pinned on
  // scroll/resize.
  const [coords, setCoords] = useState<{
    top: number;
    left?: number;
    right?: number;
  } | null>(null);

  useLayoutEffect(() => {
    function reposition() {
      const el = anchorRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const top = rect.bottom + 4;
      if (isRtl) {
        setCoords({ top, left: Math.max(VIEWPORT_GUTTER, rect.left) });
      } else {
        setCoords({
          top,
          right: Math.max(VIEWPORT_GUTTER, window.innerWidth - rect.right),
        });
      }
    }
    reposition();
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [anchorRef, isRtl]);

  if (typeof document === "undefined" || coords === null) return null;

  return createPortal(
    <div
      id={id}
      role="tooltip"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        top: coords.top,
        left: coords.left,
        right: coords.right,
        maxWidth: Math.min(POPOVER_WIDTH, window.innerWidth - VIEWPORT_GUTTER * 2),
      }}
      className={[
        "z-[1000] w-max",
        "rounded-md bg-ink-primary",
        "px-2.5 py-1.5",
        "text-[12px] font-medium leading-snug text-white",
        "shadow-[0_2px_8px_rgba(0,0,0,0.18)]",
      ].join(" ")}
    >
      {text}
    </div>,
    document.body,
  );
}
