"use client";

import Link from "next/link";
import Image from "next/image";
import { Pencil, Package, Warehouse, TriangleAlert } from "lucide-react";
import type { StockProduct, StockState } from "@/lib/inventory/stock-position-types";
import { CarrierMark } from "@/components/shared/CarrierMark";
import { Bar, CAPITAL_COLORS, Sparkline } from "./StockPrimitives";

/**
 * The product's own picture, which is how anyone actually recognises a row at a
 * glance — the catalogue carries two boxing dolls whose names differ by one
 * Arabic word. Falls back to a neutral glyph rather than a broken frame, since
 * `image_url` is nullable and most rows in Tunisia have none.
 */
function ProductThumb({ src, name }: { src: string | null; name: string }) {
  if (!src) {
    return (
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-oms-border bg-oms-sunken text-oms-ink-3"
        aria-hidden
      >
        <Package size={17} />
      </span>
    );
  }
  return (
    <span className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-oms-border bg-oms-sunken">
      <Image
        src={src}
        alt={name}
        fill
        sizes="40px"
        className="object-cover"
        unoptimized
      />
    </span>
  );
}

/**
 * Shared grid template — header and rows read from the same constant so a
 * column can never drift out of alignment with its heading.
 */
export const STOCK_ROW_GRID =
  "grid grid-cols-[minmax(180px,2.05fr)_minmax(220px,2.7fr)_minmax(104px,1fr)_minmax(150px,1.9fr)_92px_104px_124px] items-center gap-x-3";

const VERDICT_TONE: Record<StockState, string> = {
  out: "bg-oms-bad-bg text-oms-bad",
  reorder_now: "bg-oms-bad-bg text-oms-bad",
  watch: "bg-oms-warn-bg text-oms-warn-ink",
  overstocked: "bg-oms-sunken text-oms-ink-2",
  dead: "bg-oms-sunken text-oms-ink-2",
  unknown: "bg-oms-sunken text-oms-ink-3",
  ok: "bg-brand-bg text-brand-hover",
};

/** §4.17 D — colour escalates, and never carries the signal alone. */
function coverTone(p: StockProduct): { cls: string; warn: boolean } {
  if (p.days_of_cover === null) return { cls: "text-oms-ink-3 font-semibold", warn: false };
  if (p.state === "out" || p.days_of_cover <= 7) return { cls: "text-oms-bad", warn: true };
  if (p.days_of_cover <= 45) return { cls: "text-oms-warn-ink", warn: true };
  return { cls: "text-brand-hover", warn: false };
}

export function StockProductRow({
  p,
  locale,
  labels,
  onAdjust,
  formatMoney,
}: {
  p: StockProduct;
  locale: string;
  labels: {
    verdict: string;
    stockOutOn: string | null;
    reorderBy: string | null;
    dormantFor: string | null;
    perDay: string;
    demandTotal: string;
    register: string;
    engaged: string;
    free: string;
    adjust: string;
    sparkAria: string;
    unverified: string | null;
  };
  onAdjust?: () => void;
  formatMoney: (n: number) => string;
}) {
  const deficit = p.free_to_sell < 0 ? -p.free_to_sell : 0;
  const engagedUnits = Math.min(p.physical_stock, p.committed);
  const freeUnits = Math.max(0, p.free_to_sell);
  const scale = p.physical_stock + p.committed + deficit || 1;
  const pct = (n: number) => (n / scale) * 100;

  const cover = coverTone(p);
  const returnPct = p.return_rate === null ? null : Math.round(p.return_rate * 100);
  const returnHigh = returnPct !== null && returnPct > 25;

  return (
    <li className={`${STOCK_ROW_GRID} border-b border-oms-border px-4 py-3.5 last:border-b-0 hover:bg-oms-sunken`}>
      {/* produit — l'image porte l'identification, le texte porte les faits */}
      <div className="flex min-w-0 items-center gap-2.5">
        <ProductThumb src={p.image_url} name={p.name} />
        <div className="min-w-0">
          <Link
            href={`/${locale}/products/${p.id}`}
            className="block truncate text-[13.5px] font-semibold leading-tight text-oms-ink-1 hover:underline"
            dir="auto"
          >
            {p.name}
          </Link>
          <div className="mt-1 flex min-w-0 items-center gap-1.5">
            {p.source === "carrier" && p.carrier_name ? (
              <CarrierMark name={p.carrier_name} size={16} />
            ) : (
              <span
                className="grid h-4 w-4 shrink-0 place-items-center rounded-[4px] bg-oms-sunken text-oms-ink-3"
                aria-hidden
              >
                <Warehouse size={10} />
              </span>
            )}
            <span className="truncate text-[11px] text-oms-ink-3" dir="auto">
              {p.carrier_name ?? labels.register}
            </span>
            <span className="shrink-0 text-oms-border-strong" aria-hidden>
              ·
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-oms-ink-3">
              {formatMoney(p.unit_cogs)}
            </span>
          </div>
        </div>
      </div>

      {/* position */}
      <div>
        <Bar
          segments={[
            { key: "free", width: pct(freeUnits), color: CAPITAL_COLORS.active },
            { key: "engaged", width: pct(engagedUnits), color: CAPITAL_COLORS.engaged },
            { key: "deficit", width: pct(deficit), color: CAPITAL_COLORS.deficit, hatched: true },
          ]}
        />
        <div className="mt-1.5 flex items-center gap-3 text-[11.5px] font-semibold tabular-nums text-oms-ink-2">
          <span className="inline-flex items-center gap-1.5">
            <i
              className="block h-[7px] w-[7px] rounded-[2px]"
              style={{ background: CAPITAL_COLORS.dormant }}
            />
            {p.physical_stock.toLocaleString(locale)}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i
              className="block h-[7px] w-[7px] rounded-[2px]"
              style={{ background: CAPITAL_COLORS.engaged }}
            />
            {p.committed.toLocaleString(locale)}
          </span>
          <span className={`inline-flex items-center gap-1.5 ${p.free_to_sell < 0 ? "text-oms-bad" : ""}`}>
            {p.free_to_sell >= 0 ? (
              <i
                className="block h-[7px] w-[7px] rounded-[2px]"
                style={{ background: CAPITAL_COLORS.active }}
              />
            ) : null}
            {p.free_to_sell < 0 ? "−" : ""}
            {Math.abs(p.free_to_sell).toLocaleString(locale)}
          </span>
        </div>
      </div>

      {/* couverture */}
      <div>
        <div className={`flex items-center gap-1.5 text-[17px] font-bold leading-tight tabular-nums ${cover.cls}`}>
          {cover.warn ? <TriangleAlert size={13} className="shrink-0" aria-hidden /> : null}
          {p.days_of_cover === null ? "—" : `${p.days_of_cover} j`}
        </div>
        <div className="mt-1 text-[11px] leading-snug text-oms-ink-2">
          {labels.stockOutOn ?? labels.dormantFor ?? "—"}
          {labels.reorderBy ? (
            <>
              <br />
              {labels.reorderBy}
            </>
          ) : null}
        </div>
      </div>

      {/* demande */}
      <div>
        <Sparkline
          values={p.demand_series.map((d) => d.units)}
          ariaLabel={labels.sparkAria}
        />
        <div className="mt-0.5 text-[11.5px] tabular-nums text-oms-ink-2">
          {labels.demandTotal} · {labels.perDay}
        </div>
      </div>

      {/* retours */}
      <div className="text-center">
        <div
          className={`text-[14px] font-bold tabular-nums ${returnHigh ? "text-oms-warn-ink" : "text-oms-ink-1"}`}
        >
          {returnPct === null ? "—" : `${returnPct} %`}
        </div>
        <div className="mx-auto mt-1.5 h-1 w-14 overflow-hidden rounded-pill bg-oms-sunken">
          <i
            className="block h-full"
            style={{
              width: `${Math.min(100, (returnPct ?? 0) * 2.6)}%`,
              background: returnHigh ? "var(--oms-warn)" : "var(--chart-line)",
            }}
          />
        </div>
      </div>

      {/* valeur */}
      <div className="text-center">
        <div className="text-[14px] font-bold tabular-nums text-oms-ink-1">
          {formatMoney(p.stock_value)}
        </div>
        {labels.unverified ? (
          <div className="mt-0.5 text-[10.5px] text-oms-ink-3">{labels.unverified}</div>
        ) : null}
      </div>

      {/* verdict */}
      <div className="flex items-center justify-center gap-1.5">
        <span
          className={`inline-flex rounded-[6px] px-2.5 py-1 text-[12px] font-semibold ${VERDICT_TONE[p.state]}`}
        >
          {labels.verdict}
        </span>
        {onAdjust ? (
          <button
            type="button"
            onClick={onAdjust}
            aria-label={labels.adjust}
            className="rounded-[6px] p-1 text-oms-ink-3 hover:bg-oms-surface hover:text-oms-ink-1"
          >
            <Pencil size={13} aria-hidden />
          </button>
        ) : null}
      </div>
    </li>
  );
}
