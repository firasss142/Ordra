"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Boxes, Lock, PackageCheck, Search, TriangleAlert, ClipboardList } from "lucide-react";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import { WhCard, WhKpiCard, WhKpiGrid, WhPill } from "./primitives";
import { WH_LABEL } from "./tokens";
import { StockCountDialog } from "./StockCountDialog";
import { StockCard } from "./StockCard";
import {
  applyStockFilters, stockFacets, stateOf, EMPTY_STOCK_FILTER,
  type StockFilter, type StockSegment, type StockSort,
} from "@/lib/warehouse/stock-filters";

const fetcher = (url: string) => fetch(url).then((r) => {
  if (!r.ok) throw new Error(String(r.status));
  return r.json();
});

type StockTranslate = (key: string, values?: Record<string, string | number>) => string;

function relativeDay(iso: string | null, t: StockTranslate): string {
  if (!iso) return t("never");
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t("countedToday");
  if (days === 1) return t("countedYesterday");
  return t("countedDaysAgo", { days });
}

/** The four states of a shelf, in the order the floor cares about them. */
const SEGMENTS: StockSegment[] = ["all", "low", "negative", "uncounted"];

export function WarehouseStockClient({ locale }: { locale: string }) {
  const t = useTranslations("warehouse.stock");
  const tf = useTranslations("warehouse.stock.filters");
  const { data, error, isLoading, mutate } = useSWR<{ rows: WarehouseStockRow[] }>(
    "/api/warehouse/stock",
    fetcher,
    { revalidateOnFocus: true },
  );
  const [counting, setCounting] = useState<WarehouseStockRow | null>(null);
  const [filter, setFilter] = useState<StockFilter>(EMPTY_STOCK_FILTER);
  const patch = (next: Partial<StockFilter>) => setFilter((f) => ({ ...f, ...next }));
  const query = filter.q;

  const all = useMemo(() => data?.rows ?? [], [data]);

  /*
   * The search the mockup promises. A picker standing at a shelf knows the
   * code or the name, not the position in an alphabetical list, so both are
   * matched — and the KPIs above deliberately keep describing the WHOLE
   * catalogue, not the filtered view.
   */
  const rows = useMemo(() => applyStockFilters(all, filter), [all, filter]);
  // The segment counts describe what the SEARCH left, so a tab never promises
  // rows the search has already removed.
  const searched = useMemo(
    () => applyStockFilters(all, { ...EMPTY_STOCK_FILTER, q: filter.q }),
    [all, filter.q],
  );
  const facets = useMemo(() => stockFacets(searched), [searched]);

  /*
   * The phone's two chips follow the SEARCH: a chip that ignores the filter
   * under it reads as a bug. The desk KPI grid keeps describing the whole
   * catalogue, which is what a manager compares day to day.
   */
  const neverCountedAll = all.length > 0 && all.every((r) => r.last_counted_at === null);

  const cells = useMemo(() => {
    const low = all.filter((r) => r.current_stock <= r.low_stock_threshold);
    const negative = all.filter((r) => r.free < 0);
    const engaged = all.reduce((n, r) => n + r.engaged, 0);
    return [
      { id: "products", label: t("kpiProducts"), value: all.length, tone: "muted" as const, icon: Boxes },
      {
        id: "low", label: t("kpiLow"), value: low.length,
        tone: low.length ? ("warn" as const) : ("muted" as const), icon: TriangleAlert,
        edge: low.length ? ("warn" as const) : undefined, dim: low.length === 0,
      },
      { id: "engaged", label: t("kpiEngaged"), value: engaged, tone: "scan" as const, icon: Lock },
      {
        id: "negative", label: t("kpiNegative"), value: negative.length,
        tone: negative.length ? ("bad" as const) : ("muted" as const), icon: PackageCheck,
        edge: negative.length ? ("bad" as const) : undefined, dim: negative.length === 0,
      },
    ];
  }, [all, t]);

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 py-5 md:px-6 md:py-6">
      <header className="mb-4 md:mb-5">
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-wh-ink-1 md:text-[24px] md:font-semibold">
          {t("title")}
        </h1>
        <p className="mt-1 text-[13px] text-wh-ink-2">{t("subtitle")}</p>
      </header>

      <label className="mb-4 flex items-center gap-2.5 rounded-wh border border-wh-border bg-wh-surface px-3.5 py-2.5 focus-within:border-wh-ok">
        <Search size={16} className="shrink-0 text-wh-ink-3" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => patch({ q: e.target.value })}
          placeholder={t("searchPlaceholder")}
          aria-label={t("searchPlaceholder")}
          className="min-w-0 flex-1 bg-transparent text-[14px] text-wh-ink-1 outline-none placeholder:text-wh-ink-3"
        />
      </label>

      <div className="mb-3 flex flex-col gap-2">
        <div
          role="group"
          aria-label={tf("all")}
          // Bleeds to the screen edge so the last chip is visibly cut and reads
          // as scrollable. The bleed must match the page padding at BOTH widths
          // (px-4 phone, px-6 desk) or the row sits off-grid on a desk.
          className="-mx-4 flex gap-2 overflow-x-auto px-4 [-ms-overflow-style:none] [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden"
        >
          {SEGMENTS.map((key) => {
            const on = filter.seg === key;
            const count = facets[key];
            return (
              <button
                key={key}
                type="button"
                data-testid="wh-stock-seg"
                data-key={key}
                aria-pressed={on}
                onClick={() => patch({ seg: key })}
                className={[
                  "inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[10px] border px-3 text-[13.5px] font-semibold",
                  on
                    ? "border-wh-ok bg-wh-ok-bg text-wh-ok"
                    : key === "negative" && count > 0
                      ? "border-wh-bad-edge bg-wh-bad-bg text-wh-bad"
                      : key === "low" && count > 0
                        ? "border-wh-warn-edge bg-wh-warn-bg text-wh-warn"
                        : "border-wh-border bg-wh-surface text-wh-ink-2",
                  count === 0 && !on ? "opacity-45" : "",
                ].join(" ")}
              >
                {tf(key)}
                <b className="tabular-nums">{count}</b>
              </button>
            );
          })}
          <label className="inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-[10px] border border-wh-border bg-wh-surface px-3 text-[13px] text-wh-ink-2">
            <span>{tf("sort")}</span>
            <select
              value={filter.sort}
              onChange={(e) => patch({ sort: e.target.value as StockSort })}
              aria-label={tf("sort")}
              className="bg-transparent text-[13px] font-semibold text-wh-ink-1 outline-none"
            >
              <option value="name">{tf("sortName")}</option>
              <option value="stock">{tf("sortStock")}</option>
              <option value="free">{tf("sortFree")}</option>
            </select>
          </label>
        </div>
        {neverCountedAll ? (
          <span data-testid="wh-stock-never-counted" className="text-[12.5px] text-wh-ink-3">
            {t("neverCountedAll")}
          </span>
        ) : null}
      </div>
      <div className="mb-4 hidden md:block">
        <WhKpiGrid>
        {cells.map((c) => (
          <WhKpiCard key={c.id} {...c} />
        ))}
      </WhKpiGrid>
      </div>

      <WhCard title={t("title")} hint={`${rows.length}`}>
        {error ? (
          <p className="px-4 py-8 text-center text-[13px] text-wh-bad">{t("loadError")}</p>
        ) : isLoading ? (
          <div className="space-y-2 p-4" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 rounded-[8px] bg-wh-sunken" />
            ))}
          </div>
        ) : all.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-wh-ink-3">{t("empty")}</p>
        ) : rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-[13px] text-wh-ink-3">{tf("noMatch")}</p>
            <button
              type="button"
              onClick={() => setFilter(EMPTY_STOCK_FILTER)}
              className="mt-2 inline-flex h-9 items-center rounded-[8px] border border-wh-border px-3 text-[13px] font-semibold text-wh-ink-1"
            >
              {tf("clear")}
            </button>
          </div>
        ) : (
          <>
            {/* The phone gets cards: a six-column table on a 390px screen is a
                horizontal scroll, and a picker cannot scroll sideways with a
                parcel in the other hand. */}
            <div className="flex flex-col gap-2.5 p-2.5 md:hidden">
              {rows.map((r) => (
                <StockCard key={r.product_id} row={r} onCount={setCounting} />
              ))}
            </div>
            <div className="hidden overflow-x-auto md:block">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-wh-border">
                  <th className={`px-4 py-2.5 text-start ${WH_LABEL}`}>{t("colProduct")}</th>
                  <th className={`px-4 py-2.5 text-end ${WH_LABEL}`}>{t("colHeld")}</th>
                  <th className={`px-4 py-2.5 text-end ${WH_LABEL}`}>{t("colEngaged")}</th>
                  <th className={`px-4 py-2.5 text-end ${WH_LABEL}`}>{t("colFree")}</th>
                  <th className={`px-4 py-2.5 text-start ${WH_LABEL}`}>{t("colCounted")}</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const low = r.current_stock <= r.low_stock_threshold;
                  const negative = r.free < 0;
                  return (
                    <tr key={r.product_id} className="border-b border-wh-border last:border-0 hover:bg-wh-surface-2">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <span className="font-semibold text-wh-ink-1">{r.name}</span>
                          {negative ? (
                            <WhPill tone="bad">{t("negative")}</WhPill>
                          ) : low ? (
                            <WhPill tone="warn">{t("low")}</WhPill>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-end tabular-nums text-wh-ink-1">{r.current_stock}</td>
                      <td className="px-4 py-3 text-end tabular-nums text-wh-ink-2">{r.engaged}</td>
                      <td className={`px-4 py-3 text-end font-semibold tabular-nums ${negative ? "text-wh-bad" : "text-wh-ink-1"}`}>
                        {r.free}
                      </td>
                      <td className="px-4 py-3 text-[12.5px] text-wh-ink-3">
                        {relativeDay(r.last_counted_at, t)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {/* Movements live in the Journal, filtered — not duplicated here. */}
                          <Link
                            href={`/${locale}/warehouse/history?product_id=${r.product_id}`}
                            className="inline-flex items-center gap-1.5 rounded-[8px] border border-wh-border px-2.5 py-1.5 text-[12.5px] font-semibold text-wh-ink-2 hover:border-wh-border-strong"
                          >
                            <ClipboardList size={13} aria-hidden="true" />
                            {t("movements")}
                          </Link>
                          <button
                            type="button"
                            onClick={() => setCounting(r)}
                            className="rounded-[8px] border border-wh-ok bg-wh-ok px-3 py-1.5 text-[12.5px] font-semibold text-white hover:opacity-90"
                          >
                            {t("count")}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </>
        )}
      </WhCard>

      {counting ? (
        <StockCountDialog
          row={counting}
          onClose={() => setCounting(null)}
          onDone={() => {
            setCounting(null);
            void mutate();
          }}
        />
      ) : null}
    </div>
  );
}
