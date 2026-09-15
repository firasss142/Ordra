"use client";

/**
 * The console's own pieces: KPI tiles, the bars, the tab strip, the sheet
 * frame. Everything here is presentational — it takes numbers and renders
 * them, and knows nothing about where they came from.
 *
 * Design: prototypes/prospects-manager-v1.html. Tokens and rules:
 * docs/design-system.md. The raw hex values match the prototype and the rest
 * of src/components/prospects — the local convention for this page.
 */
import { useId } from "react";
import type { Tone } from "@/lib/prospects/presentation";
import { TONE, type IconComponent } from "../ui";

/** A white card with a hairline border. The page's one surface. */
export const CARD = "rounded-xl border border-[#E5E7EB] bg-white";

export const PRIMARY =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#15803D] font-semibold text-white transition-colors hover:bg-[#12692F] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803D] disabled:cursor-not-allowed disabled:opacity-50";
export const OUTLINE =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-[#D1D5DB] bg-white font-semibold text-[#111827] transition-colors hover:bg-[#F9FAFB] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803D] disabled:cursor-not-allowed disabled:opacity-50";
export const DARK =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-[#111111] font-semibold text-white transition-colors hover:bg-[#000] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#111] disabled:cursor-not-allowed disabled:opacity-50";

/** Thousands with a narrow no-break space, the way the prototype reads. */
export function fmt(n: number, locale = "fr"): string {
  return new Intl.NumberFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR")
    .format(Math.round(n))
    .replace(/ | /g, " ");
}

/**
 * The underline tab strip. This is the design system's §4.11 — the one place
 * the brand green underline is allowed — and it is what the prototype already
 * draws.
 */
export function Tabs<T extends string>({
  tabs, value, onChange, label, trailing,
}: {
  tabs: { key: T; label: string; icon?: IconComponent; badge?: number; badgeTone?: "red" | "amber" }[];
  value: T;
  onChange: (key: T) => void;
  label: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div role="tablist" aria-label={label} className="mb-3.5 flex items-center gap-1 border-b border-[#E5E7EB]">
      {tabs.map((t) => {
        const on = t.key === value;
        const Icon = t.icon;
        return (
          <button
            key={t.key}
            role="tab"
            type="button"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`relative inline-flex h-[42px] items-center gap-2 px-3.5 text-[14.5px] transition-colors ${
              on ? "font-semibold text-[#111827]" : "font-medium text-[#374151] hover:text-[#111827]"
            }`}
          >
            {Icon ? <Icon size={17} aria-hidden className={on ? "text-[#15803D]" : "text-[#6B7280]"} /> : null}
            {t.label}
            {t.badge ? (
              <span
                className={`inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11.5px] font-semibold tabular-nums ${
                  t.badgeTone === "amber" ? "bg-[#FEF3C7] text-[#92400E]" : "bg-[#FEE2E2] text-[#B91C1C]"
                }`}
              >
                {fmt(t.badge)}
              </span>
            ) : null}
            {on ? (
              <span aria-hidden className="absolute inset-x-0 -bottom-px h-[2px] rounded-full bg-[#15803D]" />
            ) : null}
          </button>
        );
      })}
      {trailing ? <div className="ms-auto">{trailing}</div> : null}
    </div>
  );
}

/** A small segmented control: the period picker, the market scope. */
export function Segmented<T extends string>({
  options, value, onChange, label,
}: { options: { key: T; label: string }[]; value: T; onChange: (k: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg border border-[#E5E7EB] bg-white p-[3px]">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`h-7 rounded-md px-2.5 text-[13px] transition-colors ${
            value === o.key ? "bg-[#111111] font-semibold text-white" : "text-[#374151] hover:bg-[#F9FAFB]"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type KpiTone = "plain" | "amber" | "red" | "green";

const KPI_TONE: Record<KpiTone, string> = {
  plain: "border-[#E5E7EB] bg-white",
  amber: "border-[#FBBF24] bg-[#FFFBEB]",
  red: "border-[#FCA5A5] bg-[#FEF2F2]",
  green: "border-[#E5E7EB] bg-white",
};

/**
 * One KPI tile. A button when it leads somewhere — most of them do, because a
 * number a manager cannot click is a number they have to go hunting for.
 */
export function Kpi({
  label, value, unit, detail, tone = "plain", icon: Icon, spark, onClick, ariaLabel,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  detail?: React.ReactNode;
  tone?: KpiTone;
  icon?: IconComponent;
  spark?: number[];
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const inner = (
    <>
      <span className="flex items-center gap-1.5 text-[13px] text-[#6B7280]">
        {Icon ? <Icon size={14} aria-hidden /> : null}
        {label}
      </span>
      <span className={`text-[26px] font-bold leading-none tracking-[-0.02em] tabular-nums ${tone === "green" ? "text-[#15803D]" : "text-[#111827]"}`}>
        {value}
        {unit ? <small className="ms-1 text-[13px] font-medium text-[#6B7280]">{unit}</small> : null}
      </span>
      <span className="text-[12.5px] text-[#6B7280]">{detail}</span>
      {spark && spark.length > 1 ? (
        <Spark values={spark} tone={tone === "green" ? "green" : "grey"} className="absolute end-3.5 top-4" />
      ) : null}
    </>
  );

  const shell = `relative flex flex-col gap-1 overflow-hidden rounded-xl border px-4 py-3.5 text-start ${KPI_TONE[tone]}`;

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={ariaLabel ?? label}
        className={`${shell} transition-colors hover:border-[#9CA3AF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803D]`}>
        {inner}
      </button>
    );
  }
  return <div role="group" aria-label={ariaLabel ?? label} className={shell}>{inner}</div>;
}

/** A section heading above a row of tiles. */
export function SectionHead({ title, aside }: { title: string; aside?: React.ReactNode }) {
  return (
    <div className="mb-[-6px] mt-0.5 flex items-baseline gap-2">
      <h2 className="m-0 text-[15px] font-bold text-[#111827]">{title}</h2>
      {aside ? <span className="text-[13px] text-[#6B7280]">{aside}</span> : null}
    </div>
  );
}

/** The seven-point trend line behind a KPI. Decorative, so it is hidden. */
export function Spark({ values, tone = "grey", className = "", width = 84, height = 30 }: {
  values: number[]; tone?: "grey" | "green"; className?: string; width?: number; height?: number;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const d = values
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * step).toFixed(1)},${(height - ((v - min) / span) * (height - 4) - 2).toFixed(1)}`)
    .join(" ");
  return (
    <svg aria-hidden width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} fill="none">
      <path d={d} stroke={tone === "green" ? "#22C55E" : "#C7CDD6"} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * "+12 %" in green, "−20 %" in red. `lowerIsBetter` flips the colour for the
 * figures where dropping is the win — first-contact delay, chiefly.
 */
export function Delta({ current, previous, suffix, lowerIsBetter = false, locale = "fr" }: {
  current: number; previous: number; suffix?: string; lowerIsBetter?: boolean; locale?: string;
}) {
  if (!previous) return suffix ? <>{suffix}</> : null;
  const pct = Math.round(((current - previous) / previous) * 100);
  const good = pct === 0 || (lowerIsBetter ? pct < 0 : pct > 0);
  return (
    <>
      <b className={`font-semibold tabular-nums ${good ? "text-[#15803D]" : "text-[#B91C1C]"}`}>
        {pct > 0 ? "+" : pct < 0 ? "−" : ""}{fmt(Math.abs(pct), locale)} %
      </b>
      {suffix ? <> {suffix}</> : null}
    </>
  );
}

/** A thin progress track. Used for agent caps and conversion rates. */
export function Bar({ pct, tone = "brand", className = "" }: {
  pct: number; tone?: "brand" | "amber" | "red" | "grey"; className?: string;
}) {
  const fill = { brand: "bg-[#15803D]", amber: "bg-[#F59E0B]", red: "bg-[#EF4444]", grey: "bg-[#9CA3AF]" }[tone];
  return (
    <span aria-hidden className={`block h-1.5 overflow-hidden rounded-full bg-[#F3F4F6] ${className}`}>
      <span className={`block h-full rounded-full ${fill}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </span>
  );
}

/** A sunk box carrying a note, with a leading glyph. */
export function Hint({ icon: Icon, children }: { icon?: IconComponent; children: React.ReactNode }) {
  return (
    <p className="m-0 flex items-start gap-2 rounded-lg bg-[#F3F4F6] px-3 py-2.5 text-[13px] text-[#374151]">
      {Icon ? <Icon size={16} aria-hidden className="mt-px shrink-0 text-[#6B7280]" /> : null}
      <span>{children}</span>
    </p>
  );
}

/** The banner at the top of the overview: something needs doing. */
export function Alert({
  tone, icon: Icon, title, desc, cta, onCta,
}: {
  tone: "red" | "amber";
  icon?: IconComponent;
  title: React.ReactNode;
  desc: React.ReactNode;
  cta?: string;
  onCta?: () => void;
}) {
  const skin = tone === "red"
    ? "border-[#FCA5A5] bg-[#FEF2F2]"
    : "border-[#FBBF24] bg-[#FFFBEB]";
  const ink = tone === "red" ? "text-[#B91C1C]" : "text-[#92400E]";
  return (
    <div className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${skin}`}>
      {Icon ? <Icon size={20} aria-hidden className={`shrink-0 ${ink}`} /> : null}
      <div className="min-w-0 flex-1">
        <p className={`m-0 text-[15px] font-bold ${ink}`}>{title}</p>
        <p className="m-0 mt-0.5 text-[13.5px] text-[#374151]">{desc}</p>
      </div>
      {cta && onCta ? (
        <button type="button" onClick={onCta}
          className={`h-10 shrink-0 px-3.5 text-[14px] ${tone === "red" ? PRIMARY : OUTLINE}`}>
          {cta}
        </button>
      ) : null}
    </div>
  );
}

/** A round monogram. `online` adds the green ring the team cards use. */
export function Avatar({ name, size = "md", online }: {
  name: string; size?: "sm" | "md"; online?: boolean;
}) {
  const px = size === "sm" ? "h-6 w-6 text-[11px]" : "h-[34px] w-[34px] text-[14px]";
  return (
    <span
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full bg-[#F3F4F6] font-bold uppercase text-[#111827] ${px} ${
        online ? "ring-2 ring-[#22C55E] ring-offset-2 ring-offset-white" : ""
      }`}
    >
      {name.trim().charAt(0) || "—"}
    </span>
  );
}

/** A stage of the funnel: a label, a bar drawn to the top stage, a count. */
export function FunnelRow({ label, value, total, tone = "grey", locale = "fr" }: {
  label: string; value: number; total: number; tone?: "grey" | "brand" | "green" | "red"; locale?: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  const fill = { grey: "bg-[#9CA3AF]", brand: "bg-[#15803D]", green: "bg-[#22C55E]", red: "bg-[#FCA5A5]" }[tone];
  return (
    <div className="grid grid-cols-[96px_1fr_56px_52px] items-center gap-2 lg:grid-cols-[150px_1fr_70px_60px]">
      <span className="truncate text-[13px] text-[#374151]">{label}</span>
      <span aria-hidden className="block h-[22px] overflow-hidden rounded-[5px] bg-[#F3F4F6]">
        <span className={`block h-full ${fill}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="text-end text-[13.5px] font-bold tabular-nums text-[#111827]">{fmt(value, locale)}</span>
      <span className="text-end text-[12.5px] tabular-nums text-[#6B7280]">{Math.round(pct)} %</span>
    </div>
  );
}

/** A loss reason: how many, drawn against the worst one. */
export function LossRow({ label, value, max, locale = "fr" }: {
  label: string; value: number; max: number; locale?: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="grid grid-cols-[92px_1fr_40px] items-center gap-2 lg:grid-cols-[130px_1fr_44px]">
      <span className="truncate text-[13px] text-[#374151]">{label}</span>
      <span aria-hidden className="block h-3.5 overflow-hidden rounded-[4px] bg-[#F3F4F6]">
        <span className="block h-full bg-[#EF4444] opacity-75" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-end text-[13px] font-semibold tabular-nums text-[#111827]">{fmt(value, locale)}</span>
    </div>
  );
}

/** A tone-coloured status pill, smaller than the situation chip. */
export function Pill({ tone, children }: { tone: Tone | "line"; children: React.ReactNode }) {
  const skin = tone === "line"
    ? "border border-[#D1D5DB] bg-white font-medium text-[#374151]"
    : TONE[tone].chip;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-semibold ${skin}`}>
      {children}
    </span>
  );
}

/** A filter chip with its count, as the pipeline's strip draws them. */
export function FilterChip({
  label, count, active, tone, onClick, locale = "fr",
}: {
  label: string; count?: number; active: boolean; tone?: Tone | "red"; onClick: () => void; locale?: string;
}) {
  const dot = tone && tone !== "red" ? TONE[tone].dot : tone === "red" ? "bg-[#EF4444]" : null;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex h-[30px] items-center gap-2 rounded-full border px-3 text-[13px] transition-colors ${
        active
          ? "border-[#111111] bg-[#111111] text-white"
          : tone === "red"
            ? "border-[#FCA5A5] bg-white text-[#B91C1C] hover:bg-[#FEF2F2]"
            : "border-[#D1D5DB] bg-white text-[#111827] hover:bg-[#F9FAFB]"
      }`}
    >
      {dot && !active ? <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${dot}`} /> : null}
      {label}
      {count !== undefined ? (
        <b className={`font-semibold tabular-nums ${active ? "text-[#D1D5DB]" : "text-[#6B7280]"}`}>{fmt(count, locale)}</b>
      ) : null}
    </button>
  );
}

/**
 * The sheet: a bottom sheet on a phone, a centred dialog on a desktop.
 * Escape closes, the backdrop closes, and the panel takes focus on open.
 */
export function Sheet({
  title, sub, onClose, footer, wide = false, children,
}: {
  title: string;
  sub?: React.ReactNode;
  onClose: () => void;
  footer?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-[rgba(17,24,39,0.35)] lg:items-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}
        className={`flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white text-start outline-none lg:rounded-2xl ${
          wide ? "lg:w-[980px]" : "lg:w-[600px]"
        }`}
      >
        <div className="flex items-start gap-2.5 px-5 pb-3 pt-4 lg:px-6">
          <div className="min-w-0 flex-1">
            <h2 id={headingId} className="m-0 text-[19px] font-bold text-[#111827]">{title}</h2>
            {sub ? <p className="m-0 mt-0.5 text-[13.5px] text-[#6B7280]">{sub}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={title}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[#374151] hover:bg-[#F3F4F6]"
          >
            <svg viewBox="0 0 24 24" width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden>
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-5 pb-4 lg:px-6">{children}</div>
        {footer ? (
          <div className="flex shrink-0 items-center gap-2.5 border-t border-[#E5E7EB] px-5 py-3.5 lg:px-6">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/** A labelled form field. */
export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-semibold text-[#111827]">{label}</span>
      {children}
      {hint ? <span className="text-[12px] text-[#6B7280]">{hint}</span> : null}
    </label>
  );
}

export const INPUT =
  "h-10 w-full rounded-lg border border-[#D1D5DB] bg-white px-3 text-[14px] text-[#111827] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[#15803D]";

/** A toggle in a row of choices: products, cities, outcomes. */
export function Toggle({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[13px] transition-colors ${
        on
          ? "border-[#15803D] bg-[#F1FAF4] font-semibold text-[#15803D]"
          : "border-[#D1D5DB] bg-white text-[#374151] hover:bg-[#F9FAFB]"
      }`}
    >
      {children}
    </button>
  );
}

/** An empty state: a sentence, centred, never a spinner left behind. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="m-0 px-5 py-12 text-center text-[14.5px] text-[#6B7280]">{children}</p>;
}
