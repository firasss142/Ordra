"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { WH_CARD, WH_LABEL, WH_STRIPE, WH_TONE, type WhTone } from "./tokens";

/**
 * Entrepôt console primitives.
 *
 * The dark warehouse surface is built from five shapes, and every screen in
 * docs/design/entrepot/entrepot-spec.md is a composition of them. They exist
 * as one module so the section cannot drift into a second visual dialect —
 * which is exactly what happened to `shared/*` (inline hex) versus `shell/*`
 * (semantic tokens) in the light era.
 */

/* ── The tinted icon square that fronts every figure ─────────────── */

export function WhHolder({
  icon: Icon,
  tone,
  size = 38,
}: {
  icon: LucideIcon;
  tone: WhTone;
  size?: number;
}) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-[10px] border ${WH_TONE[tone].holder}`}
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.45)} aria-hidden="true" />
    </span>
  );
}

/* ── Pill ─────────────────────────────────────────────────────────── */

export function WhPill({
  tone = "muted",
  icon: Icon,
  children,
}: {
  tone?: WhTone;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill border px-2 py-0.5 text-[11.5px] font-semibold ${WH_TONE[tone].pill}`}
    >
      {Icon ? <Icon size={11} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ── KPI strip: one card, N cells divided by hairlines ─────────────── */

export interface WhKpiCellDef {
  id: string;
  label: string;
  value: ReactNode;
  tone: WhTone;
  icon: LucideIcon;
  /** Context chip under the figure — an age, a delta, a target. */
  chip?: ReactNode;
  /** 0–100. Omitted when there is nothing to pace against. */
  gaugePct?: number;
  /**
   * Nothing to do. Draws a quiet check instead of a gauge, so an empty
   * queue stops competing for attention with a full one.
   */
  settled?: boolean;
}

export function WhKpiCell({ cell }: { cell: WhKpiCellDef }) {
  const tone = WH_TONE[cell.tone];
  return (
    <div className="flex min-w-0 flex-col gap-3 px-5 py-4">
      <div className="flex items-start gap-3">
        <WhHolder icon={cell.icon} tone={cell.tone} />
        <div className="min-w-0">
          <div
            className={`text-[32px] font-semibold leading-none tracking-[-0.022em] tabular-nums ${
              cell.settled ? "text-wh-ink-3" : "text-wh-ink-1"
            }`}
          >
            {cell.value}
          </div>
          <div className={`mt-1.5 ${WH_LABEL}`}>{cell.label}</div>
        </div>
      </div>

      {cell.chip ? <div className="flex">{cell.chip}</div> : null}

      <div className="mt-auto pt-1">
        {cell.settled ? (
          <span
            data-testid="wh-kpi-settled"
            className="inline-flex items-center gap-1.5 text-[11.5px] text-wh-ink-3"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="m8.5 12.5 2.5 2.5 4.5-5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            à jour
          </span>
        ) : cell.gaugePct !== undefined ? (
          <div data-testid="wh-kpi-gauge" className="h-[3px] overflow-hidden rounded-pill bg-wh-sunken">
            <i
              className={`block h-full rounded-pill ${tone.fill}`}
              style={{ width: `${Math.min(Math.max(cell.gaugePct, 2), 100)}%` }}
            />
          </div>
        ) : (
          <div className="h-[3px]" />
        )}
      </div>
    </div>
  );
}

export function WhKpiStrip({ cells }: { cells: WhKpiCellDef[] }) {
  return (
    <div className={`${WH_CARD} grid divide-y divide-wh-border sm:grid-flow-col sm:auto-cols-fr sm:divide-x sm:divide-y-0`}>
      {cells.map((cell) => (
        <WhKpiCell key={cell.id} cell={cell} />
      ))}
    </div>
  );
}

/* ── Action row: icon · title · detail · value · chevron ───────────── */

export function WhActionRow({
  icon,
  tone,
  title,
  detail,
  value,
  unit,
  stripe,
  onClick,
}: {
  icon: LucideIcon;
  tone: WhTone;
  title: string;
  detail: string;
  value: ReactNode;
  unit: string;
  stripe?: "bad" | "warn";
  onClick?: () => void;
}) {
  const body = (
    <>
      <WhHolder icon={icon} tone={tone} size={34} />
      <span className="min-w-0 flex-1 text-start">
        <span className="block truncate text-[13.5px] font-semibold text-wh-ink-1">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-wh-ink-2">{detail}</span>
      </span>
      <span className="whitespace-nowrap text-end text-[15px] font-semibold tabular-nums text-wh-ink-1">
        {value}
        <span className="ms-1 text-[11px] font-semibold text-wh-ink-3">{unit}</span>
      </span>
      {onClick ? <ChevronRight size={16} className="shrink-0 text-wh-ink-3" aria-hidden="true" /> : null}
    </>
  );

  const shell = `flex w-full items-center gap-3 px-4 py-3.5 ${stripe ? WH_STRIPE[stripe] : ""}`;

  if (!onClick) return <div className={shell}>{body}</div>;
  return (
    <button type="button" onClick={onClick} className={`${shell} transition-colors hover:bg-wh-surface-2`}>
      {body}
    </button>
  );
}

/* ── Card shell ───────────────────────────────────────────────────── */

export function WhCard({
  title,
  hint,
  actions,
  footer,
  children,
  className = "",
}: {
  title?: string;
  hint?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`${WH_CARD} ${className}`}>
      {title ? (
        <header className="flex items-center gap-2.5 border-b border-wh-border px-4 py-3">
          <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-wh-ink-1">{title}</h2>
          {hint ? <span className="text-[12px] text-wh-ink-3">{hint}</span> : null}
          {actions ? <div className="ms-auto flex items-center gap-2">{actions}</div> : null}
        </header>
      ) : null}
      {children}
      {footer ? (
        <footer className="border-t border-wh-border bg-wh-sunken px-4 py-2.5 text-[12px] text-wh-ink-3">
          {footer}
        </footer>
      ) : null}
    </section>
  );
}
