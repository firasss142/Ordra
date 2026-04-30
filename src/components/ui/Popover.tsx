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
    const rect = triggerRef.current.getBoundingClientRect();
    const panelWidth = panelRef.current?.offsetWidth ?? rect.width;
    const left =
      align === "end"
        ? rect.right + window.scrollX - panelWidth
        : rect.left + window.scrollX;
    const top = rect.bottom + window.scrollY + 4;
    const clampedLeft = Math.max(
      8,
      Math.min(left, window.scrollX + window.innerWidth - panelWidth - 8),
    );
    setPos({ top, left: clampedLeft, width: rect.width });
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

  return (
    <>
      {enhancedTrigger}
      {open && pos ? (
        <div
          ref={panelRef}
          id={panelId}
          role="dialog"
          style={{ position: "absolute", top: pos.top, left: pos.left, zIndex: 50 }}
          className={`rounded-lg border border-line bg-surface-card shadow-floating ${panelClassName}`.trim()}
        >
          {typeof children === "function" ? children(close) : children}
        </div>
      ) : null}
    </>
  );
}
