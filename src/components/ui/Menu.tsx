"use client";

import { cloneElement, isValidElement, useEffect, useRef, type ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import { Popover } from "./Popover";

export interface MenuItem {
  /** Stable id so React can reconcile keyboard nav state. */
  id: string;
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  /** Renders in critical color — for cancel / delete-style items. */
  destructive?: boolean;
}

interface MenuProps {
  trigger: ReactElement;
  items: MenuItem[];
  align?: "start" | "end";
  ariaLabel?: string;
}

/**
 * Roving-tabindex menu rendered through Popover. Up/Down moves focus, Home/End
 * jump to first/last, Enter activates and closes, ESC closes (handled by
 * Popover). Disabled items are skipped by keyboard nav.
 */
export function Menu({ trigger, items, align = "end", ariaLabel }: MenuProps) {
  if (!isValidElement(trigger)) {
    throw new Error("Menu trigger must be a valid React element");
  }

  return (
    <Popover
      trigger={trigger}
      align={align}
      panelClassName="min-w-[220px] py-1.5"
    >
      {(close) => (
        <MenuList
          items={items}
          ariaLabel={ariaLabel}
          onSelect={(item) => {
            if (item.disabled) return;
            item.onSelect();
            close();
          }}
        />
      )}
    </Popover>
  );
}

function MenuList({
  items,
  ariaLabel,
  onSelect,
}: {
  items: MenuItem[];
  ariaLabel?: string;
  onSelect: (item: MenuItem) => void;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const enabledIdxs = items
    .map((it, i) => (it.disabled ? -1 : i))
    .filter((i) => i !== -1);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const first = list.querySelector<HTMLButtonElement>("button[role=menuitem]:not([disabled])");
    first?.focus();
  }, []);

  function focusAt(targetIdx: number) {
    const list = listRef.current;
    if (!list) return;
    const buttons = Array.from(
      list.querySelectorAll<HTMLButtonElement>("button[role=menuitem]:not([disabled])"),
    );
    const target = buttons[targetIdx];
    target?.focus();
  }

  function currentEnabledIdx(): number {
    const list = listRef.current;
    if (!list) return -1;
    const buttons = Array.from(
      list.querySelectorAll<HTMLButtonElement>("button[role=menuitem]:not([disabled])"),
    );
    return buttons.indexOf(document.activeElement as HTMLButtonElement);
  }

  function onKey(e: React.KeyboardEvent<HTMLUListElement>) {
    if (enabledIdxs.length === 0) return;
    const last = enabledIdxs.length - 1;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const cur = currentEnabledIdx();
      focusAt(cur === -1 || cur === last ? 0 : cur + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const cur = currentEnabledIdx();
      focusAt(cur <= 0 ? last : cur - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      focusAt(0);
    } else if (e.key === "End") {
      e.preventDefault();
      focusAt(last);
    }
  }

  return (
    <ul
      ref={listRef}
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={onKey}
      className="flex flex-col"
    >
      {items.map((item) => {
        const Icon = item.icon;
        const colorClass = item.destructive
          ? "text-status-critical hover:bg-status-criticalBg"
          : "text-ink-primary hover:bg-surface-hover";
        return (
          <li key={item.id} role="none">
            <button
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => onSelect(item)}
              className={[
                "w-full flex items-center gap-2 px-3 h-9 text-[13px] text-start",
                "transition-colors duration-fast",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                colorClass,
              ].join(" ")}
            >
              {Icon ? (
                <Icon size={14} strokeWidth={2} aria-hidden="true" className="flex-shrink-0" />
              ) : null}
              <span className="truncate">{item.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
