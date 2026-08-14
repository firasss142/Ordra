"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface KpiStat {
  icon: LucideIcon;
  tone: "ok" | "warn" | "bad" | "muted";
  value: string;
  label: string;
}

const STAT_TONE: Record<KpiStat["tone"], string> = {
  ok: "text-brand",
  warn: "text-oms-warn",
  bad: "text-oms-bad",
  muted: "text-oms-ink-3",
};

/**
 * One question per card: value, cover, waste, trust.
 *
 * The three-stat footer is the point of the shape — a headline figure alone
 * says how big, never what it is made of, and every one of these four numbers
 * is only actionable once you can see its composition.
 */
export function StockKpiCard({
  label,
  value,
  unit,
  negative = false,
  visual,
  chips,
  stats,
}: {
  label: string;
  value: string;
  unit?: string | null;
  negative?: boolean;
  visual?: ReactNode;
  chips?: ReactNode;
  stats: KpiStat[];
}) {
  return (
    <div className="flex flex-col rounded-card border border-oms-border bg-oms-surface p-4 transition-[border-color,box-shadow] duration-base hover:border-oms-border-strong hover:shadow-hover-row">
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.075em] text-oms-ink-2">
        {label}
      </div>

      <div
        className={`mt-2 text-[30px] font-[650] leading-[1.1] tracking-[-0.022em] tabular-nums ${
          negative ? "text-oms-bad" : "text-oms-ink-1"
        }`}
      >
        {value}
        {unit ? (
          <span className="ms-1.5 text-[0.52em] font-semibold tracking-normal text-oms-ink-3">
            {unit}
          </span>
        ) : null}
      </div>

      {visual}
      {chips}

      <div className="mt-auto grid grid-cols-3 border-t border-oms-border pt-3 [&>*+*]:border-s [&>*+*]:border-oms-border [&>*+*]:ps-3">
        {stats.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="flex items-start gap-2 pe-2">
              <Icon size={15} className={`mt-0.5 shrink-0 ${STAT_TONE[s.tone]}`} aria-hidden />
              <div className="min-w-0">
                <div className="whitespace-nowrap text-[13.5px] font-semibold leading-tight tabular-nums text-oms-ink-1">
                  {s.value}
                </div>
                <div className="mt-0.5 truncate text-[11.5px] text-oms-ink-2">{s.label}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function KpiChip({
  tone,
  icon: Icon,
  children,
}: {
  tone: "ok" | "bad" | "muted";
  icon?: LucideIcon;
  children: ReactNode;
}) {
  const cls =
    tone === "ok"
      ? "bg-brand-bg text-brand-hover"
      : tone === "bad"
        ? "border border-oms-bad/30 bg-oms-surface text-oms-bad"
        : "bg-oms-sunken text-oms-ink-2";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] font-semibold tabular-nums ${cls}`}
    >
      {Icon ? <Icon size={12} className="shrink-0" aria-hidden /> : null}
      {children}
    </span>
  );
}
