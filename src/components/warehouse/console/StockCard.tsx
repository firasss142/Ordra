"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Package } from "lucide-react";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import type { WarehouseHistoryRow } from "@/lib/warehouse/history-fetch";

/**
 * One product on the phone: a row that answers "how many do I have" at a
 * glance and opens for the rest.
 *
 * On the shelf the picker matches the name, reads the figure, moves on.
 * Reserved, the alert threshold, the last count, the last movements and the
 * count action are rare questions, so they live behind a tap, where they no
 * longer push the next product off the screen. Nothing here is faked: a
 * product nobody has counted says "jamais compté", a target nobody set is
 * not shown as a goal of zero.
 */

type State = "negative" | "low" | "ok";

/** Owing more than you hold outranks merely being low: it is already broken. */
function stateOf(row: WarehouseStockRow): State {
  if (row.free < 0) return "negative";
  if (row.current_stock <= row.low_stock_threshold) return "low";
  return "ok";
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

function relativeDay(iso: string, t: Translate): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t("countedToday");
  if (days === 1) return t("countedYesterday");
  return t("countedDaysAgo", { days });
}

/** −1 / +3, with a real minus sign: a hyphen next to a digit reads as a dash. */
function signed(n: number | null): string {
  if (n === null) return "";
  return n < 0 ? `−${Math.abs(n)}` : `+${n}`;
}

export function StockCard({
  row,
  onCount,
}: {
  row: WarehouseStockRow;
  onCount: (row: WarehouseStockRow) => void;
}) {
  const t = useTranslations("warehouse.stock") as unknown as Translate;
  const state = stateOf(row);
  const [open, setOpen] = useState(false);
  const [moves, setMoves] = useState<WarehouseHistoryRow[] | null>(null);

  // The movements are fetched the first time the row opens, never for every
  // row on the screen: a hundred products would mean a hundred requests.
  useEffect(() => {
    if (!open || moves !== null) return;
    let cancelled = false;
    fetch(`/api/warehouse/history?product_id=${encodeURIComponent(row.product_id)}&limit=5`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((body: { rows?: WarehouseHistoryRow[] }) => {
        if (!cancelled) setMoves(body.rows ?? []);
      })
      .catch(() => {
        if (!cancelled) setMoves([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, moves, row.product_id]);

  return (
    <article
      data-testid="wh-stock-card"
      data-state={state}
      data-open={open ? "true" : "false"}
      className={`overflow-hidden rounded-[12px] border bg-wm-card ${
        state === "negative" ? "border-wh-bad-edge" : state === "low" ? "border-wh-warn-edge" : "border-wm-card-edge"
      }`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-0.5 px-3.5 py-3 text-start"
      >
        <span
          data-testid="wh-stock-thumb"
          aria-hidden="true"
          className="row-span-2 grid h-11 w-11 place-items-center overflow-hidden rounded-[8px] border border-wm-card-edge bg-wm-ground text-wm-ink-3"
        >
          {row.image_url ? (
            // Raw <img>: the project configures no images.remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <Package size={18} />
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[16px] font-bold leading-tight text-wm-ink">{row.name}</span>
        </span>
        <span
          data-testid="wh-stock-shelf"
          className={`text-end text-[22px] font-bold leading-none tabular-nums ${
            state === "negative" ? "text-wh-bad" : state === "low" ? "text-wh-warn" : "text-wm-ink"
          }`}
        >
          {row.current_stock}
        </span>
        <span className="flex min-w-0 items-center gap-1.5 text-[12.5px] text-wm-ink-2">
          {row.sku ? <span className="truncate" dir="ltr">{row.sku}</span> : null}
          {state === "negative" ? (
            <span className="rounded-pill border border-wh-bad-edge bg-wh-bad-bg px-2 text-[11.5px] font-semibold text-wh-bad">{t("negative")}</span>
          ) : state === "low" ? (
            <span className="rounded-pill border border-wh-warn-edge bg-wh-warn-bg px-2 text-[11.5px] font-semibold text-wh-warn">{t("low")}</span>
          ) : null}
        </span>
        <span className="flex items-center justify-end gap-1.5 text-[12.5px] text-wm-ink-2">
          <span>{t("onShelf")}</span>
          <span className="text-wm-ink-3">·</span>
          <span data-testid="wh-stock-free" data-neg={row.free < 0 ? "true" : "false"} className={`tabular-nums ${row.free < 0 ? "font-bold text-wh-bad" : ""}`}>
            {t("freeUnits", { n: row.free })}
          </span>
          <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} />
        </span>
      </button>

      {open ? (
        <div data-testid="wh-stock-more" className="border-t border-wm-card-edge px-3.5 py-3 text-[14px] text-wm-ink-2">
          <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            <dt>{t("reservedUnits")}</dt>
            <dd className="text-end font-semibold tabular-nums text-wm-ink">{row.engaged}</dd>
            <dt>{t("thresholdAt", { threshold: row.low_stock_threshold }).split(":")[0]}</dt>
            <dd className="text-end font-semibold tabular-nums text-wm-ink">{row.low_stock_threshold}</dd>
            {row.stock_goal !== null ? (
              <>
                <dt>{t("stockOfGoal", { stock: row.current_stock, goal: row.stock_goal })}</dt>
                <dd className="text-end font-semibold tabular-nums text-wm-ink">{row.goal_pct ?? 0} %</dd>
              </>
            ) : null}
            <dt>{t("lastCount")}</dt>
            <dd className="text-end font-semibold text-wm-ink">
              {row.last_counted_at ? relativeDay(row.last_counted_at, t) : t("never")}
              {row.accuracy !== null ? ` · ${t("accuracyShort", { pct: row.accuracy })}` : ""}
            </dd>
          </dl>
          {/* The threshold as a sentence too, so a screen reader hears the number with its meaning. */}
          <p className="sr-only">{t("thresholdAt", { threshold: row.low_stock_threshold })}</p>

          <p className="mb-1 mt-3 text-[13px] font-semibold text-wm-ink-2">{t("lastMovements")}</p>
          <ul data-testid="wh-stock-movements" className="m-0 list-none p-0">
            {moves === null ? (
              <li className="py-1 text-[13px] text-wm-ink-3">{t("loadingMovements")}</li>
            ) : moves.length === 0 ? (
              <li className="py-1 text-[13px] text-wm-ink-3">{t("noMovements")}</li>
            ) : (
              moves.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 border-b border-dashed border-wm-track py-1.5 last:border-0">
                  <span className="min-w-0 truncate text-[13.5px]">
                    {m.detail}
                    <span className="text-wm-ink-3"> · {new Date(m.at).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</span>
                  </span>
                  <b dir="ltr" className="shrink-0 tabular-nums text-wm-ink">{signed(m.qty_change)}</b>
                </li>
              ))
            )}
          </ul>

          <button
            type="button"
            onClick={() => onCount(row)}
            className="mt-3 inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] border border-wm-accent bg-wm-card px-4 text-[15px] font-bold text-wm-accent active:bg-wm-accent-soft"
          >
            {t("count")}
          </button>
        </div>
      ) : null}
    </article>
  );
}
