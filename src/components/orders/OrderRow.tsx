"use client";

import React from "react";
import { formatDateTime } from "@/lib/format";
import type { OrdersListRow } from "@/hooks/useOrdersList";

const STATUS_DOT_COLORS: Record<string, string> = {
  new: "#3B82F6",
  assigned: "#F59E0B",
  attempt_1: "#F97316",
  attempt_2: "#F97316",
  attempt_3: "#F97316",
  callback_scheduled: "#8B5CF6",
  confirmed: "#10B981",
  dispatch_scheduled: "#22C55E",
  dispatching: "#0EA5E9",
  scanned: "#0891B2",
  dispatched: "#059669",
  deposit: "#0EA5E9",
  in_transit: "#6366F1",
  to_be_returned: "#F43F5E",
  delivered: "#16A34A",
  returned: "#DC2626",
  rejected: "#EF4444",
  cancelled: "#6B7280",
};

const TERMINAL = new Set(["delivered", "returned", "rejected", "cancelled"]);

interface Props {
  order: OrdersListRow;
  locale: string;
  selected: boolean;
  highlighted: boolean;
  agentName: string | null;
  currencyCode: string;
  labels: {
    status: string;
    unassigned: string;
    cancel: string;
  };
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
  cancellingId: string | null;
}

function Row({
  order,
  locale,
  selected,
  highlighted,
  agentName,
  currencyCode,
  labels,
  onToggleSelect,
  onOpen,
  onCancel,
  cancellingId,
}: Props) {
  const statusLabel = labels.status;
  return (
    <tr
      style={{
        cursor: "pointer",
        background: selected ? "#F2F6FC" : highlighted ? "#FFFBEA" : "#FFFFFF",
        transition: "background-color 120ms ease",
      }}
      onClick={() => onOpen(order.id)}
      onMouseEnter={(e) => {
        if (!selected && !highlighted)
          (e.currentTarget as HTMLElement).style.background = "#F7F7F7";
      }}
      onMouseLeave={(e) => {
        if (!selected && !highlighted)
          (e.currentTarget as HTMLElement).style.background = "#FFFFFF";
      }}
    >
      <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(order.id)}
          aria-label={`select ${order.external_id ?? order.id}`}
          style={{ cursor: "pointer" }}
        />
      </td>
      <td style={{ ...cellStyle, fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#6D7175" }}>
        {order.external_id ?? order.id.slice(0, 8)}
      </td>
      <td style={cellStyle}>{order.customer_name}</td>
      <td style={{ ...cellStyle, color: "#6D7175" }}>{order.customer_city ?? "—"}</td>
      <td style={cellStyle}>
        {order.product_name}
        {order.variant_label ? (
          <span style={{ color: "#6D7175", fontSize: 13, marginInlineStart: 6 }}>
            · {order.variant_label}
          </span>
        ) : null}
      </td>
      <td style={{ ...cellStyle, fontWeight: 500, fontVariantNumeric: "tabular-nums" }}>
        {order.total_price.toFixed(2)} {currencyCode}
      </td>
      <td style={cellStyle}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span
            aria-hidden
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: STATUS_DOT_COLORS[order.status] ?? "#9CA3AF",
              flexShrink: 0,
            }}
          />
          <span>{statusLabel}</span>
        </div>
      </td>
      <td style={{ ...cellStyle, color: agentName ? "#1A1A1A" : "#9CA3AF" }}>
        {agentName ?? labels.unassigned}
      </td>
      <td style={{ ...cellStyle, color: "#6D7175", fontSize: 13, whiteSpace: "nowrap" }}>
        {formatDateTime(order.created_at, locale)}
      </td>
      <td style={cellStyle} onClick={(e) => e.stopPropagation()}>
        {!TERMINAL.has(order.status) ? (
          <button
            type="button"
            onClick={() => onCancel(order.id)}
            disabled={cancellingId === order.id}
            style={{
              background: "none",
              border: "none",
              color: cancellingId === order.id ? "#9CA3AF" : "#D72C0D",
              fontSize: 13,
              cursor: cancellingId === order.id ? "not-allowed" : "pointer",
              padding: 0,
            }}
          >
            {cancellingId === order.id ? "…" : labels.cancel}
          </button>
        ) : null}
      </td>
    </tr>
  );
}

const cellStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #E1E3E5",
};

export const OrderRow = React.memo(Row, (prev, next) => {
  return (
    prev.order === next.order &&
    prev.selected === next.selected &&
    prev.highlighted === next.highlighted &&
    prev.agentName === next.agentName &&
    prev.cancellingId === next.cancellingId &&
    prev.locale === next.locale &&
    prev.labels.status === next.labels.status
  );
});
