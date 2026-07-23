"use client";

import { useTranslations } from "next-intl";
import type { OrdersPreset } from "@/lib/orders/list-filters";
import { ORDERS_PRESETS } from "@/lib/orders/list-filters";

interface Props {
  active: OrdersPreset;
  onChange: (next: OrdersPreset) => void;
  counts?: Partial<Record<OrdersPreset, number>>;
}

/**
 * Preset tabs for the orders list. Underline style — the active tab carries
 * the 2px accent underline reserved by the design system for exactly this.
 */
export function OrdersPresetPills({ active, onChange, counts }: Props) {
  const t = useTranslations("orders.presets");

  return (
    <div
      role="tablist"
      aria-label={t("label")}
      className="flex items-end gap-1 overflow-x-auto"
    >
      {ORDERS_PRESETS.map((key) => {
        const isActive = active === key;
        const count = counts?.[key];
        return (
          <button
            type="button"
            key={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className={
              "relative inline-flex items-center gap-1.5 px-3 pt-1.5 pb-2 text-[13px] whitespace-nowrap bg-transparent border-0 cursor-pointer transition-colors duration-fast " +
              (isActive
                ? "font-semibold text-ink-primary"
                : "font-medium text-ink-secondary hover:text-ink-primary")
            }
          >
            {t(key)}
            {typeof count === "number" && count > 0 ? (
              <span className="text-[11px] font-medium px-1.5 py-px rounded-pill bg-surface-selected text-ink-secondary tabular-nums">
                {count}
              </span>
            ) : null}
            {isActive ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 bottom-0 h-[2px] rounded-pill bg-accent"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
