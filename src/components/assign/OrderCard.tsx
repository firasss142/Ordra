"use client";

import { useTranslations } from "next-intl";
import type { UnassignedOrder } from "@/hooks/useUnassignedOrders";
import { getAgeBucket, getBucketAccent } from "@/lib/assign/age-bucket";
import { formatCurrency } from "@/lib/format";

const ACCENT_COLOR: Record<string, string> = {
  neutral: "#6D7175",
  action: "#2C6ECB",
  success: "#008060",
  warning: "#B98900",
  critical: "#D72C0D",
};

function formatRelativeMinutes(createdAt: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(createdAt).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

interface Props {
  order: UnassignedOrder;
  selected: boolean;
  onToggle: (id: string) => void;
  marketCode: string;
  now?: Date;
}

export function OrderCard({ order, selected, onToggle, marketCode, now = new Date() }: Props) {
  const t = useTranslations("assign");
  const bucket = getAgeBucket(order.created_at, now);
  const accent = getBucketAccent(bucket);
  const accentColor = ACCENT_COLOR[accent] ?? ACCENT_COLOR.neutral;
  const ageLabel = formatRelativeMinutes(order.created_at, now);
  // Prefer the internal catalog name; fall back to the external storefront
  // string for orders that never resolved to a product.
  const productDisplayName = order.product_display_name || order.product_name;

  return (
    <div
      role="row"
      aria-selected={selected}
      style={{
        display: "flex",
        alignItems: "stretch",
        background: "#FFFFFF",
        border: selected ? "1px solid #1A1A1A" : "1px solid #E1E3E5",
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 3,
          background: accentColor,
          flexShrink: 0,
        }}
      />
      <label
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 12px 10px 10px",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(order.id)}
          aria-label={t("selectOrder", { name: order.customer_name })}
          style={{ cursor: "pointer" }}
        />
      </label>
      <div style={{ flex: 1, padding: "10px 12px 10px 0", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: "#1A1A1A" }}>
            {order.customer_name}
          </span>
          {order.customer_city ? (
            <span style={{ color: "#6D7175", fontSize: 13 }}>· {order.customer_city}</span>
          ) : null}
          <span
            style={{
              marginInlineStart: "auto",
              fontSize: 11,
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 9999,
              background: accentColor,
              color: "#FFFFFF",
              fontVariantNumeric: "tabular-nums",
            }}
            title={t(`bucket.${bucket}`)}
          >
            {ageLabel}
          </span>
        </div>
        <div
          style={{
            marginTop: 4,
            fontSize: 13,
            color: "#6D7175",
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          {productDisplayName ? (
            <span>
              {productDisplayName}
              {order.variant_label ? ` · ${order.variant_label}` : ""}
              {` × ${order.quantity}`}
            </span>
          ) : null}
          <span style={{ fontVariantNumeric: "tabular-nums", color: "#1A1A1A" }}>
            {formatCurrency(order.total_price, marketCode)}
          </span>
          {order.external_platform ? (
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                padding: "1px 6px",
                borderRadius: 4,
                background: "#F2F2F2",
                color: "#1A1A1A",
                textTransform: "uppercase",
                letterSpacing: 0.3,
              }}
              title={t("source", { platform: order.external_platform })}
            >
              {order.external_platform}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
