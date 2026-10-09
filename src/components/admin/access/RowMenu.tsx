"use client";

import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

export interface RowMenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  critical?: boolean;
  /** Draw a rule above this item (the destructive end of the menu). */
  separated?: boolean;
  onSelect: () => void;
}

/**
 * The « ⋯ » actions of one row. Opens on the first item, moves with the
 * arrows, closes on Escape, Tab or a click outside, and hands focus back to
 * its button — the old menu stayed open on an outside click and had no role.
 * Fixed-positioned from the button, because the list card clips overflow.
 */
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open || !button.current || !menu.current) return;
    const r = button.current.getBoundingClientRect();
    const w = menu.current.offsetWidth || 244;
    const h = menu.current.offsetHeight || 0;
    const rtl = getComputedStyle(button.current).direction === "rtl";
    const left = Math.max(8, Math.min(rtl ? r.left : r.right - w, window.innerWidth - w - 8));
    const below = r.bottom + 6;
    setPos({ left, top: below + h > window.innerHeight - 8 && r.top - h - 6 > 8 ? r.top - h - 6 : below });
    menu.current.querySelector<HTMLButtonElement>("[role=menuitem]")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const onScroll = () => close(false);
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const all = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    const go = (n: number) => {
      e.preventDefault();
      all[(n + all.length) % all.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(all.length - 1);
    else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      // The page closes its topmost layer on Escape; the menu is above all of them.
      e.stopPropagation();
      close(true);
    }
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="acx-kebab"
      >
        <MoreHorizontal size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          onKeyDown={onKeyDown}
          style={pos ? { top: pos.top, left: pos.left } : { visibility: "hidden" }}
          className="acx-menu"
        >
          {items.map(({ key, label: text, icon: Icon, critical, separated, onSelect }) => (
            <Fragment key={key}>
              {separated && <hr />}
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                onClick={() => {
                  close(false);
                  onSelect();
                }}
                className={`acx-menu-i${critical ? " bad" : ""}`}
              >
                <Icon size={16} aria-hidden="true" />
                {text}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </>
  );
}
