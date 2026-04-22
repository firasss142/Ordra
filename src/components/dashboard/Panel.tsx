"use client";

import type { ReactNode } from "react";

export function Panel({
  title,
  children,
  actions,
  minHeight = 280,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  minHeight?: number;
}) {
  return (
    <div
      style={{
        background: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        padding: 18,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        minHeight,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: 16,
            fontWeight: 600,
            color: "#1A1A1A",
          }}
        >
          {title}
        </h2>
        {actions ?? null}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

export function EmptyState({
  label,
  minHeight = 180,
}: {
  label: string;
  minHeight?: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight,
        fontSize: 13,
        color: "#6D7175",
      }}
    >
      {label}
    </div>
  );
}
