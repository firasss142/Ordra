"use client";

import type { ReactNode } from "react";
import type { WarehouseStockRow, StockWarehouse } from "@/app/api/warehouse/stock/route";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";

/**
 * The small pieces Stock, the product page and Mouvements share — drawn from
 * prototypes/entrepot-day-loop-{agent,manager}-v3.html (`.chip`, `.spark`,
 * `.stack-bar`, `.legend`, `.tabs`) on Ordra's tokens. Sizes are px, never the
 * rem scale: Ordra's root is 14px and the prototypes are drawn in px.
 */

export type ChipTone = "warn" | "mute" | "info" | "bad" | "ok";

const CHIP: Record<ChipTone, { box: string; dot: string }> = {
  warn: { box: "bg-wh-warn-bg text-wh-warn", dot: "bg-status-warning" },
  mute: { box: "bg-[var(--bg-selected)] text-wh-ink-2", dot: "bg-wh-ink-3" },
  info: { box: "bg-status-action/[0.08] text-status-action", dot: "bg-status-action" },
  bad: { box: "bg-wh-bad-bg text-wh-bad", dot: "bg-wh-bad" },
  ok: { box: "bg-status-successBg text-status-success", dot: "bg-status-success" },
};

/** `.chip` — a pill with a 6px dot. `dense` is the desk's 2px vertical padding. */
export function Chip({
  tone,
  children,
  dense = false,
  testId,
}: {
  tone: ChipTone;
  children: ReactNode;
  dense?: boolean;
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={`inline-flex items-center gap-[6px] whitespace-nowrap rounded-full px-[9px] text-[12px] font-semibold ${
        dense ? "py-[2px]" : "py-[3px]"
      } ${CHIP[tone].box}`}
    >
      <i aria-hidden="true" className={`h-[6px] w-[6px] shrink-0 rounded-full ${CHIP[tone].dot}`} />
      {children}
    </span>
  );
}

/**
 * `.spark` — fourteen days of a product's balance, in the job's hue.
 *
 * A shape, not a measurement: unlabelled, and hidden from screen readers (the
 * figure beside it is announced). A flat line is drawn flat — "nothing moved"
 * is a fact worth seeing.
 */
export function Sparkline({ values, width, height = 22 }: { values: number[]; width: number; height?: number }) {
  if (values.length < 2) return <span aria-hidden="true" style={{ width, height }} className="inline-block shrink-0" />;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const step = (width - 2) / (values.length - 1);
  const d = values
    .map((v, i) => {
      const x = 1 + i * step;
      // Flat → the middle; otherwise 2px of air top and bottom.
      const y = span === 0 ? height / 2 : height - 2 - ((v - min) / span) * (height - 4);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      data-testid="stock-spark"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      aria-hidden="true"
      className="shrink-0"
    >
      <path d={d} fill="none" stroke="var(--job, var(--wh-ink-3))" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

/** `.stack-bar` — engaged (ink), free (brand), on the way (hatched, only when announced). */
export function StackBar({ engaged, free, incoming }: { engaged: number; free: number; incoming: number | null }) {
  const e = Math.max(engaged, 0);
  const f = Math.max(free, 0);
  const inc = incoming && incoming > 0 ? incoming : 0;
  const total = Math.max(e + f + inc, 1);
  return (
    <div aria-hidden="true" className="flex h-[14px] overflow-hidden rounded-full bg-[var(--bg-selected)]">
      <i className="block h-full bg-wh-ink-1" style={{ width: `${(e / total) * 100}%` }} />
      <i className="block h-full bg-brand" style={{ width: `${(f / total) * 100}%` }} />
      {inc ? (
        <i
          data-testid="stack-incoming"
          className="block h-full"
          style={{
            width: `${(inc / total) * 100}%`,
            // A hatch, not a gradient for looks: units that are not here yet.
            background: "repeating-linear-gradient(45deg, var(--border-strong) 0 3px, transparent 3px 7px)",
          }}
        />
      ) : null}
    </div>
  );
}

/** One `.legend` entry: an 8px swatch, the label, the bold figure. */
export function LegendItem({ swatch, label, value }: { swatch: string; label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center">
      <i aria-hidden="true" className={`me-[6px] inline-block h-[8px] w-[8px] rounded-[2px] ${swatch}`} />
      {label}&nbsp;<b className="font-bold tabular-nums text-wh-ink-1" dir="ltr">{value}</b>
    </span>
  );
}

/** `.label` — the small uppercase section label (no tracking or capitals in Arabic). */
export const LABEL =
  "text-[11.5px] font-semibold uppercase tracking-[0.05em] text-wh-ink-2 rtl:text-[12.5px] rtl:normal-case rtl:tracking-normal";
export const LABEL_DESK =
  "text-[11px] font-semibold uppercase tracking-[0.06em] text-wh-ink-2 rtl:text-[12px] rtl:normal-case rtl:tracking-normal";

/** A figure that reads left to right inside Arabic text (`.num`). */
export function Num({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span dir="ltr" className={`tabular-nums [unicode-bidi:isolate] ${className}`}>
      {children}
    </span>
  );
}

/** −1 / +3 with a real minus sign: a hyphen next to a digit reads as a dash. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : "0";
}

function intlLocale(locale: string): string {
  // Latin digits on the Libyan bench, like every other figure in Ordra.
  return locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR";
}

/** « 29 sept. » / « 29 سبتمبر ». */
export function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { day: "numeric", month: "short" }).format(new Date(iso));
}

/** « 29 sept. · 14:42 » — when a movement happened, in the reader's language. */
export function whenLabel(iso: string, locale: string): string {
  const time = new Intl.DateTimeFormat(intlLocale(locale), {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
  return `${shortDate(iso, locale)} · ${time}`;
}

/** The event a ledger row records — its REASON, or its stream for a print / handover. */
export function eventKey(row: Pick<WarehouseHistoryRow, "kind" | "reason">): string {
  if (row.kind === "print" || row.kind === "handover") return row.kind;
  return row.reason ?? "manual_adjustment";
}

/** Seconds a first count takes per product, measured on the floor. */
const SECONDS_PER_PRODUCT = 25;
export function countMinutes(products: number): number {
  return Math.max(1, Math.round((products * SECONDS_PER_PRODUCT) / 60));
}

/**
 * Whether a product has never been counted — at one building when one is in
 * view (an agent's own, or the desk's building switch), else anywhere.
 */
export function neverCounted(row: WarehouseStockRow, siteId: string | null, warehouses: StockWarehouse[]): boolean {
  if (siteId && warehouses.length > 1) {
    return !row.sites.find((s) => s.warehouse_id === siteId)?.last_counted_at;
  }
  return row.last_counted_at === null;
}

/**
 * « sous le seuil » — the prototype's rule: what can still be PROMISED (free =
 * register − engaged) is at or under the alert threshold. A shelf full of
 * units already spoken for is not a shelf that can take the next order.
 */
export function isLow(row: Pick<WarehouseStockRow, "free" | "low_stock_threshold">): boolean {
  return row.free <= row.low_stock_threshold;
}

/** When a product was last counted — at the building in view, else anywhere. */
export function lastCountedAt(row: WarehouseStockRow, siteId: string | null, warehouses: StockWarehouse[]): string | null {
  if (siteId && warehouses.length > 1) {
    return row.sites.find((s) => s.warehouse_id === siteId)?.last_counted_at ?? null;
  }
  return row.last_counted_at;
}

/** The product's thumb: its photo when it has one, else the job's tile. */
export function Thumb({ src, size, radius, icon }: { src: string | null; size: number; radius: number; icon: ReactNode }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, borderRadius: radius }}
      className="grid shrink-0 place-items-center overflow-hidden bg-job-bg text-job-ink"
    >
      {src ? (
        // Raw <img>: the project configures no images.remotePatterns.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        icon
      )}
    </span>
  );
}
