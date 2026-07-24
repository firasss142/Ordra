"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useAlertsPanel } from "@/context/alerts-panel";
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

export function AlertAttentionBar({ byType, totalCount, role, locale: _locale, labels }: AlertAttentionBarProps) {
  const { openPanel } = useAlertsPanel();
  if (!byType) return null;

  if (totalCount === 0) {
    if (role !== "super_admin") return null;
    return (
      <div className="self-start inline-flex items-center gap-1.5 bg-status-successBg text-status-success rounded-pill px-3 py-1.5 text-[13px] font-medium">
        <Check size={14} strokeWidth={2.5} aria-hidden />
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
    <div className="bg-surface-card border border-line-subtle rounded-[8px] px-3.5 py-2.5 flex flex-wrap items-center gap-2">
      <TriangleAlert size={14} strokeWidth={2.25} aria-hidden className="text-status-warning" />
      {chips.map((chip) => (
        <span
          key={chip.text}
          className="bg-status-warningBg text-status-warning rounded-pill px-2.5 py-0.5 text-[12px] font-medium"
        >
          {chip.text}
        </span>
      ))}
      <button
        type="button"
        onClick={() => openPanel()}
        className="ms-auto bg-transparent border-0 p-0 cursor-pointer text-[12px] font-semibold text-ink-primary whitespace-nowrap"
        style={{ fontFamily: "inherit" }}
      >
        {labels.viewAll}
      </button>
    </div>
  );
}
