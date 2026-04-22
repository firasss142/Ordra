"use client";

import { X } from "lucide-react";

interface WarehouseInboxBannerProps {
  count: number;
  onReveal: () => void;
  onDismiss: () => void;
  labels: {
    reveal: string; // "{count} nouvelles · Afficher"
    dismiss: string;
  };
}

function formatLabel(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export function WarehouseInboxBanner({
  count,
  onReveal,
  onDismiss,
  labels,
}: WarehouseInboxBannerProps) {
  if (count <= 0) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "10px 14px",
        background: "#F1F8F5",
        border: "1px solid #C1E7D4",
        borderRadius: 8,
      }}
    >
      <button
        type="button"
        onClick={onReveal}
        style={{
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          fontSize: 13,
          fontWeight: 500,
          color: "#008060",
          cursor: "pointer",
          textAlign: "start",
        }}
      >
        {formatLabel(labels.reveal, { count })}
      </button>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={labels.dismiss}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          background: "transparent",
          border: "none",
          borderRadius: 4,
          cursor: "pointer",
          color: "#008060",
        }}
      >
        <X size={14} strokeWidth={1.75} aria-hidden="true" />
      </button>
    </div>
  );
}
