"use client";

import type { AlertSeverity } from "@/app/api/alerts/summary/route";
import { SEVERITY_COLORS } from "./constants";

export function SeverityTile({
  severity,
  count,
  active,
  onClick,
  label,
  compact,
}: {
  severity: AlertSeverity;
  count: number;
  active: boolean;
  onClick: () => void;
  label: string;
  compact?: boolean;
}) {
  const colors = SEVERITY_COLORS[severity];
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "#F6F6F7",
        border: active ? `1px solid ${colors.dot}` : "1px solid #E1E3E5",
        borderRadius: 8,
        padding: compact ? "8px 10px" : "10px 12px",
        textAlign: "start",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: compact ? 3 : 4,
        transition: "border-color 120ms ease",
      }}
      aria-pressed={active}
    >
      <div style={{ display: "flex", alignItems: "center", gap: compact ? 6 : 8 }}>
        <span
          aria-hidden="true"
          style={{
            width: 8,
            height: 8,
            borderRadius: 9999,
            backgroundColor: colors.dot,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: 10,
            fontWeight: 500,
            color: "#6D7175",
            textTransform: "uppercase",
            letterSpacing: "0.04em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontSize: compact ? 20 : 24,
          fontWeight: 700,
          color: count > 0 ? "#1A1A1A" : "#6D7175",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {count}
      </span>
    </button>
  );
}

export function Chip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: active ? "#FFFFFF" : "transparent",
        color: "#1A1A1A",
        fontSize: 12,
        fontWeight: active ? 600 : 500,
        padding: "5px 12px",
        borderRadius: 6,
        cursor: "pointer",
        boxShadow: active ? "0 1px 2px rgba(0,0,0,0.06)" : "none",
        fontFamily: "inherit",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </button>
  );
}
