"use client";

import type { AlertSeverity } from "@/lib/alerts/types";
import { CLEAR_ICON, CLEAR_TONE, SEVERITY_BAR, SEVERITY_ICONS, SEVERITY_TONE } from "./constants";

/**
 * One severity's standing.
 *
 * A zero tile is kept rather than hidden — "no critical alerts" is information,
 * and a missing tile says nothing. It turns green with a check instead of going
 * grey, so a cleared band reads as an achievement at a glance rather than as a
 * disabled control.
 */
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
  const empty = count === 0;
  const tone = empty ? CLEAR_TONE : SEVERITY_TONE[severity];
  const Icon = empty ? CLEAR_ICON : SEVERITY_ICONS[severity];

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={empty}
      aria-pressed={active}
      className={[
        "flex flex-col items-start gap-2 rounded-[14px] border text-start transition-all duration-fast",
        compact ? "px-3 py-3" : "px-3.5 py-3.5",
        tone.card,
        active ? "ring-2 ring-oms-border-strong" : "",
        empty ? "cursor-default" : "cursor-pointer hover:brightness-[0.985]",
      ].join(" ")}
    >
      <span className="flex w-full items-center gap-2">
        <span
          aria-hidden="true"
          className={`grid h-6 w-6 flex-shrink-0 place-items-center rounded-full ${tone.solid}`}
        >
          <Icon size={14} strokeWidth={2.5} />
        </span>
        <span
          className={`truncate text-[10.5px] font-bold uppercase tracking-[0.04em] ${tone.label}`}
        >
          {label}
        </span>
      </span>
      <span className="text-[26px] font-bold leading-none tabular-nums text-oms-ink-1">
        {count}
      </span>
    </button>
  );
}

/**
 * The whole board in one line: how the open alerts split across severities.
 *
 * Four numbers in four tiles say how many; this says what the mix *is* — an
 * inbox that is nine-tenths low-severity noise looks completely different from
 * one that is half critical, and the tiles alone never showed that shape.
 */
export function SeverityBar({
  bySeverity,
  order,
}: {
  bySeverity: Record<AlertSeverity, number> | null;
  order: readonly AlertSeverity[];
}) {
  const total = order.reduce((sum, s) => sum + (bySeverity?.[s] ?? 0), 0);
  if (total === 0) return null;

  return (
    <div aria-hidden="true" className="flex h-1 w-full gap-1 overflow-hidden">
      {order.map((severity) => {
        const count = bySeverity?.[severity] ?? 0;
        if (count === 0) return null;
        return (
          <span
            key={severity}
            className={`h-full rounded-pill ${SEVERITY_BAR[severity]}`}
            style={{ width: `${(count / total) * 100}%` }}
          />
        );
      })}
    </div>
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
      aria-pressed={active}
      className={[
        "whitespace-nowrap rounded-pill border px-3.5 py-[7px] text-[12.5px] transition-colors duration-fast",
        active
          ? "border-transparent bg-brand font-semibold text-white"
          : "border-transparent bg-oms-sunken font-medium text-oms-ink-2 hover:bg-oms-surface hover:text-oms-ink-1",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
