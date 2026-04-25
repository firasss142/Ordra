"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { CallbackRow } from "@/hooks/useCallbacksDueSoon";

interface CallbacksDueSoonProps {
  rows: CallbackRow[];
  isLoading: boolean;
}

function urgencyStyle(minutesUntil: number): React.CSSProperties {
  if (minutesUntil < 0)
    return { color: "#D72C0D", fontWeight: 600 };
  if (minutesUntil < 5)
    return { color: "#D72C0D", fontWeight: 600 };
  if (minutesUntil < 15)
    return { color: "#B98900", fontWeight: 500 };
  return { color: "#008060", fontWeight: 400 };
}

function minutesLabel(mins: number): string {
  if (mins < 0) return `${Math.abs(mins)}m overdue`;
  if (mins === 0) return "now";
  return `in ${mins}m`;
}

export function CallbacksDueSoon({ rows, isLoading }: CallbacksDueSoonProps) {
  const t = useTranslations("confirmationFlow");
  const [pingedIds, setPingedIds] = useState<Set<string>>(new Set());

  function ping(orderId: string) {
    // TODO(v2): route through /api/notifications channel
    setPingedIds((s) => new Set([...s, orderId]));
    setTimeout(() => {
      setPingedIds((s) => {
        const n = new Set(s);
        n.delete(orderId);
        return n;
      });
    }, 3000);
  }

  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        minWidth: 280,
        maxWidth: 380,
        flexShrink: 0,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "16px 20px 12px",
          borderBottom: "1px solid #E1E3E5",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A" }}>
          {t("callbacks.title")}
        </span>
        {rows.length > 0 && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              background: rows.some((r) => r.minutes_until < 5) ? "#D72C0D" : "#B98900",
              color: "#FFFFFF",
              borderRadius: 10,
              padding: "2px 8px",
            }}
          >
            {rows.length}
          </span>
        )}
      </div>

      {isLoading ? (
        <div style={{ padding: 16, color: "#6D7175", fontSize: 12 }}>
          {t("callbacks.loading")}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: 20, color: "#6D7175", fontSize: 12, textAlign: "center" }}>
          {t("callbacks.empty")}
        </div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: 320, overflowY: "auto" }}>
          {rows.map((row) => (
            <li
              key={row.order_id}
              style={{
                padding: "10px 16px",
                borderBottom: "1px solid #F0F0F0",
                display: "flex",
                flexDirection: "column",
                gap: 3,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13, fontWeight: 500, color: "#1A1A1A" }}>
                  {row.customer_name}
                </span>
                <span style={{ fontSize: 12, ...urgencyStyle(row.minutes_until) }}>
                  {minutesLabel(row.minutes_until)}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 11, color: "#6D7175" }}>
                  {row.agent_full_name ?? t("callbacks.unassigned")}
                </span>
                <button
                  onClick={() => ping(row.order_id)}
                  disabled={pingedIds.has(row.order_id)}
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 4,
                    border: "1px solid #E1E3E5",
                    background: pingedIds.has(row.order_id) ? "#F0F0F0" : "#FFFFFF",
                    color: pingedIds.has(row.order_id) ? "#6D7175" : "#1A1A1A",
                    cursor: pingedIds.has(row.order_id) ? "default" : "pointer",
                    fontWeight: 500,
                  }}
                >
                  {pingedIds.has(row.order_id)
                    ? t("callbacks.pinged")
                    : t("callbacks.ping")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
