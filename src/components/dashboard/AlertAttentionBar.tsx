"use client";

import type { AlertType } from "@/app/api/alerts/summary/route";
import type { DashboardRole } from "./HeroKpiStrip";

interface AlertAttentionBarLabels {
  overdueCallbacks: string;
  unassignedOverflow: string;
  lowStock: string;
  viewAll: string;
  allClear: string;
}

interface AlertAttentionBarProps {
  byType: Record<AlertType, number> | null | undefined;
  totalCount: number;
  role: DashboardRole;
  locale: string;
  labels: AlertAttentionBarLabels;
}

function interpolate(template: string, count: number): string {
  return template.replace(/\{count\}/g, String(count));
}

export function AlertAttentionBar({ byType, totalCount, role, locale, labels }: AlertAttentionBarProps) {
  if (!byType) return null;

  if (totalCount === 0) {
    if (role !== "super_admin") return null;
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          background: "#EAF7EF",
          border: "1px solid #CDE9D7",
          borderRadius: 9999,
          padding: "6px 12px",
          fontSize: 13,
          fontWeight: 500,
          color: "#008060",
          alignSelf: "flex-start",
        }}
      >
        <span style={{ fontSize: 14 }}>✓</span>
        {labels.allClear}
      </div>
    );
  }

  const overdueCount = byType.overdue_callback ?? 0;
  const unassignedCount = byType.unassigned_overflow ?? 0;
  const lowStockCount = (byType.low_stock ?? 0) + (byType.stock_depleted ?? 0);

  const chips: { text: string; count: number }[] = [];
  if (overdueCount > 0) chips.push({ text: interpolate(labels.overdueCallbacks, overdueCount), count: overdueCount });
  if (unassignedCount > 0) chips.push({ text: interpolate(labels.unassignedOverflow, unassignedCount), count: unassignedCount });
  if (lowStockCount > 0) chips.push({ text: interpolate(labels.lowStock, lowStockCount), count: lowStockCount });

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        background: "#FFF4E5",
        border: "1px solid #D4841C",
        borderRadius: 8,
        padding: "10px 14px",
        fontSize: 13,
        fontWeight: 500,
        color: "#92400E",
      }}
    >
      <span style={{ color: "#D97706", marginInlineEnd: 4 }}>⚠</span>
      {chips.map((chip) => (
        <span
          key={chip.text}
          style={{
            background: "#FEF3C7",
            border: "1px solid #FCD34D",
            borderRadius: 9999,
            padding: "2px 10px",
            color: "#92400E",
            fontSize: 12,
          }}
        >
          {chip.text}
        </span>
      ))}
      <a
        href={`/${locale}/dashboard/alerts`}
        style={{
          marginInlineStart: "auto",
          color: "#D97706",
          textDecoration: "none",
          fontWeight: 600,
          fontSize: 12,
          whiteSpace: "nowrap",
        }}
      >
        {labels.viewAll}
      </a>
    </div>
  );
}
