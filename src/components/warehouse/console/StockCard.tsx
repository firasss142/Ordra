"use client";

import { useTranslations } from "next-intl";
import { ClipboardList, Package } from "lucide-react";
import type { WarehouseStockRow } from "@/app/api/warehouse/stock/route";
import { WhSpark } from "./WhSpark";
import { WH_TONE } from "./tokens";

/**
 * One product on the phone (mockup 03-inventory).
 *
 * The card makes four claims — how much is held, how far that is from the
 * target, where it has been, and how trustworthy the number is — and every one
 * of them is dropped rather than faked when the warehouse has not done the
 * work that produces it. A product nobody has counted says "jamais compté";
 * it does not say 100 %.
 */

type State = "negative" | "low" | "ok";

/** Owing more than you hold outranks merely being low: it is already broken. */
function stateOf(row: WarehouseStockRow): State {
  if (row.free < 0) return "negative";
  if (row.current_stock <= row.low_stock_threshold) return "low";
  return "ok";
}

const STATE_TONE: Record<State, "bad" | "warn" | "ok"> = {
  negative: "bad",
  low: "warn",
  ok: "ok",
};

/**
 * Written out rather than composed. Tailwind scans source text for complete
 * class names, so `border-wh-${tone}-edge` generates no CSS at all and the
 * card would ship with an invisible border.
 */
const STATE_BORDER: Record<State, string> = {
  negative: "border-wh-bad-edge",
  low: "border-wh-warn-edge",
  ok: "border-wm-card-edge",
};

type Translate = (key: string, values?: Record<string, string | number>) => string;

function relativeDay(iso: string, t: Translate): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return t("countedToday");
  if (days === 1) return t("countedYesterday");
  return t("countedDaysAgo", { days });
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
  const tone = STATE_TONE[state];

  return (
    <article
      data-testid="wh-stock-card"
      data-state={state}
      className={`rounded-[10px] border bg-wm-card p-3.5 ${STATE_BORDER[state]}`}
    >
      <div className="flex items-start gap-3">
        {/* Identity first: on a shelf you match the picture, then the code. */}
        <span
          data-testid="wh-stock-thumb"
          className="grid h-[52px] w-[52px] shrink-0 place-items-center overflow-hidden rounded-[10px] bg-[#E9E9E9]"
        >
          {row.image_url ? (
            // Raw <img>: the project configures no images.remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={row.image_url}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <Package size={20} className="text-wm-ink-2" aria-hidden="true" />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[14px] font-bold leading-snug text-wm-ink">
            {row.name}
          </h3>
          <p className="mt-0.5 truncate text-[12px] text-wm-ink-2">
            {row.sku ?? t("noSku")}
          </p>
        </div>

        <button
          type="button"
          onClick={() => onCount(row)}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-pill border border-wm-accent bg-wm-card px-3.5 text-[12.5px] font-bold text-wm-accent active:bg-wm-accent-soft"
        >
          <ClipboardList size={14} aria-hidden="true" />
          {t("count")}
        </button>
      </div>

      <div className="mt-2.5 flex items-end gap-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1.5">
            <span
              className={`text-[22px] font-extrabold leading-none tabular-nums ${
                state === "ok" ? "text-wm-ink" : WH_TONE[tone].text
              }`}
            >
              {row.current_stock}
            </span>
            <span className="text-[11.5px] text-wm-ink-2">{t("unitsHeld")}</span>
          </div>

          {row.stock_goal !== null && row.goal_pct !== null ? (
            <>
              <div
                data-testid="wh-stock-goal-bar"
                role="progressbar"
                aria-valuenow={row.goal_pct}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={t("goalAria", { goal: row.stock_goal })}
                className="mt-2 h-1.5 overflow-hidden rounded-pill bg-wm-track"
              >
                <i
                  className={`block h-full rounded-pill ${WH_TONE[tone].fill}`}
                  style={{ width: `${row.goal_pct}%` }}
                />
              </div>
              <p
                data-testid="wh-stock-goal"
                className="mt-1.5 text-[11.5px] tabular-nums text-wm-ink-2"
              >
                {t("stockOfGoal", { stock: row.current_stock, goal: row.stock_goal })}
                <span className="ms-1.5 font-semibold text-wm-ink-2">{row.goal_pct} %</span>
              </p>
            </>
          ) : (
            // No target set. The alarm floor is a real number and is shown
            // instead — inventing a goal would misrepresent every product.
            <p
              data-testid="wh-stock-threshold"
              className="mt-2 text-[11.5px] tabular-nums text-wm-ink-2"
            >
              {t("thresholdAt", { threshold: row.low_stock_threshold })}
            </p>
          )}
        </div>

        {row.series.length >= 2 ? (
          <div className={`w-[64px] shrink-0 pb-0.5 ${state === "ok" ? "text-wm-accent" : WH_TONE[tone].text}`}>
            <WhSpark values={row.series} />
          </div>
        ) : null}
      </div>

      <footer className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-wm-card-edge pt-2.5 text-[11.5px] text-wm-ink-2">
        <span>{t("engagedUnits", { engaged: row.engaged })}</span>
        {row.last_counted_at ? (
          <span>{relativeDay(row.last_counted_at, t)}</span>
        ) : (
          <span>{t("never")}</span>
        )}
        {row.accuracy !== null ? (
          <span data-testid="wh-stock-accuracy" className="ms-auto font-semibold tabular-nums">
            {t("accuracyShort", { pct: row.accuracy })}
          </span>
        ) : null}
      </footer>
    </article>
  );
}
