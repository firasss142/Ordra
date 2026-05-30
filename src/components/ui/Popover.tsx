"use client";

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

interface PopoverProps {
  trigger: ReactElement;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "start" | "end";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  panelClassName?: string;
}

export function Popover({
  trigger,
  children,
  align = "start",
  open: controlledOpen,
  onOpenChange,
  panelClassName = "",
}: PopoverProps) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;
  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setUncontrolledOpen(next);
      onOpenChange?.(next);
    },
    [isControlled, onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);

  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const panelId = useId();
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    // Trigger rect is viewport-relative — panel uses `position: fixed` and
    // is portaled to <body>, so we DO NOT add window.scrollX / scrollY here.
    function place() {
      if (!triggerRef.current) return;
      const rect = triggerRef.current.getBoundingClientRect();
      // Width / height come from the actual mounted panel when possible; on
      // the first paint we fall back to conservative estimates so the initial
      // position isn't clamped to a too-narrow trigger width.
      const panelWidth = panelRef.current?.offsetWidth ?? 220;
      const panelHeight = panelRef.current?.offsetHeight ?? 200;
      const rawLeft =
        align === "end" ? rect.right - panelWidth : rect.left;
      // Default below the trigger. Flip above when there isn't enough room
      // and the trigger has more space above (typical for footer-anchored
      // overflow menus inside a fixed drawer).
      const spaceBelow = window.innerHeight - rect.bottom;
      const spaceAbove = rect.top;
      const flipUp = spaceBelow < panelHeight + 8 && spaceAbove > spaceBelow;
      const top = flipUp ? rect.top - panelHeight - 4 : rect.bottom + 4;
      const clampedLeft = Math.max(
        8,
        Math.min(rawLeft, window.innerWidth - panelWidth - 8),
      );
      const clampedTop = Math.max(
        8,
        Math.min(top, window.innerHeight - panelHeight - 8),
      );
      setPos({ top: clampedTop, left: clampedLeft, width: rect.width });
    }
    place();
    // Re-measure after the panel mounts to honor its real width.
    const raf = requestAnimationFrame(place);
    return () => cancelAnimationFrame(raf);
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        triggerRef.current?.contains(t) ||
        panelRef.current?.contains(t)
      ) {
        return;
      }
      close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        close();
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  if (!isValidElement(trigger)) {
    throw new Error("Popover trigger must be a valid React element");
  }

  const triggerProps = trigger.props as Record<string, unknown>;
  const enhancedTrigger = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
    },
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    "aria-controls": open ? panelId : undefined,
    onClick: (e: React.MouseEvent) => {
      const existing = triggerProps.onClick as
        | ((e: React.MouseEvent) => void)
        | undefined;
      existing?.(e);
      if (!e.defaultPrevented) setOpen(!open);
    },
  } as React.HTMLAttributes<HTMLElement> & { ref: React.Ref<HTMLElement> });

  const panel =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            // Stop pointer events from bubbling to the document — the panel is
            // a body-portaled sibling, so any host-overlay onClick handlers
            // (e.g. a fixed drawer that closes on outside click) would
            // otherwise treat the popover click as "outside the drawer" and
            // close everything. The Popover's own outside-click logic still
            // works because it uses document.addEventListener on mousedown
            // and checks containment against `panelRef`.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 70 }}
            className={`rounded-lg border border-line bg-surface-card shadow-floating ${panelClassName}`.trim()}
          >
            {typeof children === "function" ? children(close) : children}
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {enhancedTrigger}
      {panel}
    </>
  );
}
