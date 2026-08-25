"use client";

import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { WH_CARD, WH_LABEL, WH_STRIPE, WH_TONE, type WhTone } from "./tokens";

/**
 * Entrepôt console primitives.
 *
 * Every screen in docs/design/entrepot/entrepot-light.html is a composition of
 * these shapes, and their measurements come from that file — not from memory.
 * They exist as one module so the section cannot drift into a second visual
 * dialect, which is exactly what happened to `shared/*` (inline hex) versus
 * `shell/*` (semantic tokens) before.
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

/* ── Chipmini: the borderless context chip under a figure ─────────── */

export function WhChip({
  tone = "muted",
  icon: Icon,
  children,
  className = "",
}: {
  tone?: WhTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-pill px-2.5 py-[2.5px] text-[11.5px] font-semibold ${WH_TONE[tone].tint} ${className}`}
    >
      {Icon ? <Icon size={11} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

/* ── Pipeline: one card, five cells divided by hairlines ───────────── */

export interface WhPipelineCellDef {
  id: string;
  label: string;
  value: ReactNode;
  tone: WhTone;
  icon: LucideIcon;
  /** Context chip under the figure — an age, a delta, a reassurance. */
  chip?: ReactNode;
  /** 0–100, drawn as a hairline along the cell's bottom edge. */
  barPct?: number;
  /**
   * Nothing to do here. The whole cell steps back to half opacity rather than
   * earning a decoration: an empty queue should not compete with a full one.
   */
  dim?: boolean;
}

export function WhPipelineCell({ cell }: { cell: WhPipelineCellDef }) {
  const tone = WH_TONE[cell.tone];
  return (
    <div
      data-testid={`wh-cell-${cell.id}`}
      data-dim={cell.dim ? "true" : "false"}
      className={`relative flex items-start gap-3.5 px-5 pb-4 pt-[18px] ${
        cell.dim ? "opacity-50" : ""
      }`}
    >
      <span
        className={`grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[11px] ${tone.tint}`}
      >
        <cell.icon size={19} aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <div
          data-testid="wh-value"
          className="font-mono text-[30px] font-bold leading-none tracking-[-0.02em] tabular-nums text-wh-ink-1"
        >
          {cell.value}
        </div>
        <div className={`mt-[5px] ${WH_LABEL}`}>{cell.label}</div>
        {cell.chip ? <div className="mt-2 flex">{cell.chip}</div> : null}
      </div>
      {cell.barPct !== undefined && !cell.dim ? (
        // The cell's share of everything on the floor, so the five bars are
        // comparable to each other rather than each pacing against a fudge.
        <i
          data-testid="wh-bar"
          aria-hidden="true"
          className={`absolute bottom-0 start-5 h-[3px] rounded-t-[3px] ${tone.fill}`}
          style={{ width: `calc((100% - 40px) * ${Math.min(Math.max(cell.barPct, 2), 100) / 100})` }}
        />
      ) : null}
    </div>
  );
}

export function WhPipeline({ cells }: { cells: WhPipelineCellDef[] }) {
  return (
    <div
      className={`${WH_CARD} grid overflow-hidden shadow-sm divide-y divide-wh-border sm:grid-cols-2 lg:grid-cols-5 lg:divide-x lg:divide-y-0`}
    >
      {cells.map((cell) => (
        <WhPipelineCell key={cell.id} cell={cell} />
      ))}
    </div>
  );
}

/* ── KPI card: label · figure · note · divided footer ──────────────── */

/** The inset top bar that marks a card as demanding, settled, or lost. */
const KPI_EDGE: Record<"warn" | "ok" | "bad", string> = {
  warn: "border-wh-warn-edge shadow-[inset_0_2px_0_var(--wh-warn)]",
  ok: "shadow-[inset_0_2px_0_var(--wh-ok)]",
  bad: "border-wh-bad-edge shadow-[inset_0_2px_0_var(--wh-bad)]",
};

export interface WhKpiFoot {
  value: ReactNode;
  label: string;
}

export function WhKpiCard({
  id,
  label,
  icon: Icon,
  tone = "muted",
  value,
  unit,
  chip,
  note,
  progressPct,
  foot,
  edge,
  dim,
  valueTone,
  children,
}: {
  id: string;
  label: string;
  icon?: LucideIcon;
  tone?: WhTone;
  value: ReactNode;
  /** Small suffix beside the figure — %, u, a currency. */
  unit?: string;
  chip?: ReactNode;
  note?: ReactNode;
  /** 0–100 progress toward a target. */
  progressPct?: number;
  /** Up to three divided cells beneath the rule. */
  foot?: WhKpiFoot[];
  edge?: "warn" | "ok" | "bad";
  /** Nothing happening: the figure and label step back to the muted ink. */
  dim?: boolean;
  /**
   * Colours the figure itself. The prototype does this for the cards that
   * carry a verdict — an amber queue, a green day — and leaves neutral
   * measurements in the default ink.
   */
  valueTone?: WhTone;
  /** A sparkline or any other body placed under the note. */
  children?: ReactNode;
}) {
  return (
    <div
      data-testid={`wh-kpi-${id}`}
      data-dim={dim ? "true" : "false"}
      className={`rounded-wh border border-wh-border bg-wh-surface px-3.5 py-3 shadow-sm transition-[box-shadow,transform,border-color] duration-150 md:px-[18px] md:py-4 md:hover:-translate-y-px md:hover:border-wh-border-strong md:hover:shadow-md ${
        edge ? KPI_EDGE[edge] : ""
      }`}
    >
      <div className={`flex items-center gap-2 md:gap-2.5 ${WH_LABEL}`}>
        {Icon ? (
          <span className={`grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px] md:h-[30px] md:w-[30px] md:rounded-[9px] ${WH_TONE[tone].tint}`}>
            <Icon size={14} aria-hidden="true" />
          </span>
        ) : null}
        {/* A 158px card cannot hold an Arabic KPI label on one line, and
            truncating the label loses the only thing that names the figure. */}
        <span className="min-w-0 leading-tight">{label}</span>
      </div>

      <div
        data-testid="wh-value"
        className={`mt-2 flex flex-wrap items-baseline gap-1.5 font-mono text-[26px] font-bold leading-[1.05] tracking-[-0.02em] tabular-nums md:mt-2.5 md:gap-2 md:text-[29px] ${
          dim ? "text-wh-ink-3" : valueTone ? WH_TONE[valueTone].text : "text-wh-ink-1"
        }`}
      >
        {value}
        {unit ? <span className="text-[13px] font-semibold text-wh-ink-3">{unit}</span> : null}
        {chip}
      </div>

      {progressPct !== undefined ? (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-pill bg-wh-sunken">
          <i
            className="block h-full rounded-pill bg-wh-ok"
            style={{ width: `${Math.min(Math.max(progressPct, 0), 100)}%` }}
            aria-hidden="true"
          />
        </div>
      ) : null}

      {note ? <div className="mt-1.5 text-[12px] text-wh-ink-2">{note}</div> : null}
      {children}

      {foot && foot.length > 0 ? (
        <div className="mt-3 flex border-t border-wh-border pt-[11px]">
          {foot.map((f, i) => (
            <div
              key={f.label}
              className={`flex-1 ${i > 0 ? "border-s border-wh-border ps-[13px]" : ""}`}
            >
              <div className="font-mono text-[13.5px] font-semibold tabular-nums text-wh-ink-1">
                {f.value}
              </div>
              <div className="mt-px text-[11.5px] text-wh-ink-3">{f.label}</div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The KPI row: a snap-scrolling strip on a phone, an auto-fitting grid at a
 * desk.
 *
 * The grid alone collapses to one card per row at 390px, which pushes the
 * actual work — the queue — two screens down under four headline figures.
 * The strip keeps them to one band and lets the next card peek in, which is
 * the only honest signal that the row scrolls.
 *
 * The negative inline margin lets the strip bleed to the screen edges while
 * the page keeps its padding, so a card can sit half-off-screen instead of
 * stopping short of it.
 */
export function WhKpiGrid({
  children,
  min = 230,
}: {
  children: ReactNode;
  min?: number;
}) {
  return (
    <div
      className={[
        "-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1",
        "[&>*]:min-w-[158px] [&>*]:shrink-0 [&>*]:snap-start",
        "md:mx-0 md:grid md:gap-3.5 md:overflow-visible md:px-0 md:pb-0",
        "md:[&>*]:min-w-0 md:[&>*]:shrink",
        "[-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
      ].join(" ")}
      // grid-template-columns is inert under display:flex, so the phone strip
      // ignores it and the md:grid picks it up — one declaration, both layouts.
      style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))` }}
    >
      {children}
    </div>
  );
}

/* ── Action row: icon · title · detail · value · chevron ───────────── */

export function WhActionRow({
  id,
  icon,
  tone,
  title,
  detail,
  value,
  unit,
  stripe,
  onClick,
}: {
  id: string;
  icon: LucideIcon;
  tone: WhTone;
  title: string;
  detail: string;
  value: ReactNode;
  unit: string;
  /** Only the heaviest row carries one. A stripe on every row means nothing. */
  stripe?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] ${WH_TONE[tone].tint}`}
      >
        {(() => {
          const Icon = icon;
          return <Icon size={17} aria-hidden="true" />;
        })()}
      </span>
      <span className="min-w-0 flex-1 text-start">
        <span className="block text-[13.5px] font-semibold text-wh-ink-1">{title}</span>
        <span className="mt-0.5 block text-[12.5px] text-wh-ink-2">{detail}</span>
      </span>
      <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap text-end">
        <span className="font-mono text-[16px] font-bold tabular-nums text-wh-ink-1">{value}</span>
        <span className="text-[11.5px] text-wh-ink-3">{unit}</span>
      </span>
      {onClick ? <ChevronRight size={16} className="shrink-0 text-wh-ink-3" aria-hidden="true" /> : null}
    </>
  );

  const shell = `flex w-full items-start gap-3 px-[18px] py-3.5 ${
    stripe ? "shadow-[inset_3px_0_0_var(--wh-bad)]" : ""
  }`;

  if (!onClick) {
    return (
      <div data-testid={`wh-action-${id}`} data-stripe={stripe ? "true" : "false"} className={shell}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={`wh-action-${id}`}
      data-stripe={stripe ? "true" : "false"}
      className={`${shell} transition-colors hover:bg-wh-sunken`}
    >
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
