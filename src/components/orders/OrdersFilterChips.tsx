"use client";

import { useTranslations } from "next-intl";
import type { OrderListFilters, ClearableFilterKey } from "@/lib/orders/list-filters";

interface Props {
  filters: OrderListFilters;
  onClearField: (key: ClearableFilterKey) => void;
  onClearAll: () => void;
  agentNameLookup?: (id: string) => string | null;
  productNameLookup?: (id: string) => string | null;
}

/**
 * Render the currently-active filters as removable pills, so users can see and
 * surgically drop each one without hunting through controls. Tracks the same
 * grammar as the market chip in the dashboard FilterBar.
 */
export function OrdersFilterChips({
  filters,
  onClearField,
  onClearAll,
  agentNameLookup,
  productNameLookup,
}: Props) {
  const t = useTranslations("orders");
  const tStatus = useTranslations("orders.statuses");
  const tReason = useTranslations("orders.rejectionReasons");

  const chips: Array<{ key: ClearableFilterKey; label: string }> = [];

  if (filters.q) chips.push({ key: "q", label: `${t("chips.search")}: ${filters.q}` });
  if (filters.statuses.length > 0) {
    const labels = filters.statuses.map((s) => tStatus(s)).join(", ");
    chips.push({ key: "statuses", label: `${t("chips.status")}: ${labels}` });
  }
  if (filters.agentId) {
    const label =
      filters.agentId === "unassigned"
        ? t("noAssigned")
        : agentNameLookup?.(filters.agentId) ?? filters.agentId.slice(0, 8);
    chips.push({ key: "agentId", label: `${t("chips.agent")}: ${label}` });
  }
  if (filters.dateFrom || filters.dateTo) {
    const label = `${filters.dateFrom ?? "…"} → ${filters.dateTo ?? "…"}`;
    chips.push({ key: "date", label });
  }
  if (filters.productId) {
    const label = productNameLookup?.(filters.productId) ?? filters.productId.slice(0, 8);
    chips.push({ key: "productId", label: `${t("chips.product")}: ${label}` });
  }
  if (filters.city) chips.push({ key: "city", label: `${t("chips.city")}: ${filters.city}` });
  if (filters.totalMin != null || filters.totalMax != null) {
    const label = `${filters.totalMin ?? "…"} – ${filters.totalMax ?? "…"}`;
    chips.push({ key: "totalRange", label: `${t("chips.total")}: ${label}` });
  }
  if (filters.rejectionReason) {
    chips.push({ key: "rejectionReason", label: `${t("chips.reason")}: ${tReason(filters.rejectionReason)}` });
  }
  if (filters.carrierId) {
    chips.push({ key: "carrierId", label: `${t("chips.carrier")}: ${filters.carrierId.slice(0, 8)}` });
  }
  if (filters.preset !== "all") {
    const presetLabel = t(`presets.${filters.preset}`);
    chips.unshift({ key: "preset", label: presetLabel });
  }

  if (chips.length === 0) return null;

  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: 8,
      }}
    >
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onClearField(c.key)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            border: "1px solid #E1E3E5",
            borderRadius: 9999,
            background: "#F2F2F2",
            color: "#1A1A1A",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "background-color 120ms ease",
          }}
          onMouseEnter={(e) => ((e.currentTarget.style.background = "#E8E8E8"))}
          onMouseLeave={(e) => ((e.currentTarget.style.background = "#F2F2F2"))}
          aria-label={`${t("chips.remove")} ${c.label}`}
        >
          <span>{c.label}</span>
          <span aria-hidden style={{ fontSize: 13, color: "#6D7175" }}>×</span>
        </button>
      ))}
      <button
        type="button"
        onClick={onClearAll}
        style={{
          background: "none",
          border: "none",
          color: "#1A1A1A",
          fontSize: 13,
          fontWeight: 500,
          cursor: "pointer",
          padding: 0,
          textDecoration: "underline",
        }}
      >
        {t("chips.clearAll")}
      </button>
    </div>
  );
}
