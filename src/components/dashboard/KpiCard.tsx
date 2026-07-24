"use client";

import type { ReactNode } from "react";
import { TONE_COLOR, type Tone } from "./kpiDelta";

interface KpiCardProps {
  label: string;
  value: string;
  /**
   * Delta line. Provide a pre-formatted string (e.g. "+8.2%" or "-0.4 pp").
   * tone controls the color.
   */
  deltaText?: string | null;
  deltaTone?: Tone;
  /**
   * Subtitle sits below value when no chart/delta is used (e.g. "3 en ligne · 2 inactifs").
   */
  subtitle?: string | null;
  /**
   * Optional slot for a sparkline or mini visual (rendered full-width, 48px tall).
   */
  visual?: ReactNode;
  /**
   * When true, value color is muted — used for agentsOnline type cards that aren't a single number.
   */
  muted?: boolean;
}

export function KpiCard({
  label,
  value,
  deltaText,
  deltaTone = "neutral",
  subtitle,
  visual,
  muted,
}: KpiCardProps) {
  return (
    <div className="bg-surface-card border border-line-subtle rounded-[8px] px-[18px] py-4 flex flex-col gap-2.5 min-h-[124px] transition-shadow duration-fast hover:shadow-hover-row">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
        {label}
      </div>
      <div
        className={`text-[28px] font-bold tabular-nums leading-[1.1] ${muted ? "text-ink-secondary" : "text-ink-primary"}`}
      >
        {value}
      </div>
      {visual ? <div className="h-10 mt-auto">{visual}</div> : null}
      {deltaText ? (
        <div
          className="text-[13px] font-medium tabular-nums"
          style={{ color: TONE_COLOR[deltaTone] }}
        >
          {deltaText}
        </div>
      ) : subtitle ? (
        <div className="text-[13px] font-medium text-ink-secondary">{subtitle}</div>
      ) : null}
    </div>
  );
}
