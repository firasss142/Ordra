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
 * Segmented pill control for the four primary order views.
 * Mirrors PresetSegmented in [src/components/dashboard/FilterBar.tsx] so the
 * orders page feels visually continuous with the dashboard.
 */
export function OrdersPresetPills({ active, onChange, counts }: Props) {
  const t = useTranslations("orders.presets");

  return (
    <div
      role="tablist"
      aria-label={t("label")}
      style={{
        display: "inline-flex",
        border: "1px solid #E1E3E5",
        borderRadius: 9999,
        background: "#FFFFFF",
        padding: 2,
        gap: 2,
      }}
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
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              border: "none",
              borderRadius: 9999,
              background: isActive ? "#1A1A1A" : "transparent",
              color: isActive ? "#FFFFFF" : "#1A1A1A",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "background-color 120ms ease, color 120ms ease",
            }}
          >
            {t(key)}
            {typeof count === "number" && count > 0 ? (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 500,
                  padding: "1px 6px",
                  borderRadius: 9999,
                  background: isActive ? "rgba(255,255,255,0.15)" : "#F2F2F2",
                  color: isActive ? "#FFFFFF" : "#6D7175",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
