"use client";

import { useTranslations } from "next-intl";
import { Boxes, Clock, Package } from "lucide-react";
import { linesOf, isMixed, type RunRow } from "@/lib/warehouse/scan-buckets";
import { benchAgeLabel, type AgeTranslate } from "@/components/warehouse/console/PrepCard";

/**
 * The parcel in hand, before anything irreversible happens.
 *
 * There is no printer and no barcode on the box: nothing mechanical can prove
 * the parcel in hand is the parcel on screen. The photo and the product lines
 * are the only witnesses, so they are shown at a size you can match against a
 * box at arm's length, and the scanner stays shut until the agent says yes.
 *
 * EVERY LINE IS LISTED. A parcel holding three products used to render as one —
 * the denormalised product on `orders` — so a picker packed one item and the
 * sticker went on anyway. The count is stated as a sentence too, because "3
 * produits" is the fact that makes someone look twice at a box.
 */
export function RunParcel({
  row,
  currency,
  onConfirm,
  onSkip,
}: {
  row: RunRow;
  currency: string;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("warehouse.run");
  const tb = useTranslations("warehouse.bench");
  const tAge = useTranslations("warehouse.age") as unknown as AgeTranslate;

  const lines = linesOf(row);
  const mixed = isMixed(row);
  const since = row.uploaded_at ?? row.created_at;
  const hours = Math.max(0, (Date.now() - new Date(since).getTime()) / 3_600_000);
  const late = hours >= 48;
  const stock = row.current_stock ?? 0;
  const low = stock <= (row.low_stock_threshold ?? 0);
  const hero = lines.find((l) => l.image_url)?.image_url ?? row.product_image_url ?? null;

  return (
    <div data-testid="wh-run-parcel" className="grid gap-3">
      <div className="grid place-items-center gap-2.5 rounded-[14px] border border-wm-card-edge bg-wm-card p-4">
        <span
          aria-hidden="true"
          className="grid h-[150px] w-[150px] place-items-center overflow-hidden rounded-[12px] border border-wm-card-edge bg-wm-ground text-wm-ink-3"
        >
          {hero ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero} alt="" className="h-full w-full object-cover" />
          ) : mixed ? (
            <Boxes size={48} strokeWidth={1.5} />
          ) : (
            <Package size={48} strokeWidth={1.5} />
          )}
        </span>

        {/* The contents, one row per product. Never a single summarised line. */}
        <p className="text-[13px] font-semibold text-wm-ink-2">{t("linesTitle", { n: lines.length })}</p>
        <ul className="m-0 w-full list-none p-0">
          {lines.map((l, i) => (
            <li
              key={`${l.product_id ?? l.product_name}-${i}`}
              data-testid="wh-run-line"
              className="flex items-center gap-2.5 border-b border-dashed border-wm-track py-1.5 last:border-0"
            >
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-wm-card-edge bg-wm-ground text-wm-ink-3"
              >
                {l.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={l.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <Package size={15} />
                )}
              </span>
              <span className="min-w-0 flex-1 text-[15px] font-semibold leading-tight text-wm-ink">
                <bdi>{l.product_name}</bdi>
                {l.variant_label ? <span className="text-wm-ink-2"> · {l.variant_label}</span> : null}
              </span>
              <b className="shrink-0 text-[16px] tabular-nums text-wm-ink">{t("lineQty", { n: l.quantity })}</b>
            </li>
          ))}
        </ul>

        <p className="text-center text-[15px] font-bold text-wm-ink">
          <bdi>{row.customer_name}</bdi>
        </p>
        <p className="text-center text-[13.5px] text-wm-ink-2">
          {row.customer_city ? <bdi>{row.customer_city}</bdi> : null}
          {row.customer_city ? " · " : null}
          <span dir="ltr" className="tabular-nums">
            {Number(row.total_price).toFixed(2)} {currency}
          </span>
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <span
            data-testid="wh-run-age"
            data-late={late ? "true" : "false"}
            className={`inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-[12.5px] tabular-nums ${
              late ? "border-wh-warn-edge bg-wh-warn-bg font-bold text-wh-warn" : "border-wm-card-edge text-wm-ink-2"
            }`}
          >
            <Clock size={12} aria-hidden="true" />
            {benchAgeLabel(hours, tAge)}
          </span>
          <span
            data-low={low ? "true" : "false"}
            className={`inline-flex items-center rounded-pill border px-2 py-0.5 text-[12.5px] ${
              low ? "border-wh-warn-edge bg-wh-warn-bg font-semibold text-wh-warn" : "border-wm-card-edge text-wm-ink-2"
            }`}
          >
            {tb("inStock", { n: stock })}
            {low ? ` · ${tb("lowStock")}` : ""}
          </span>
        </div>
      </div>

      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex min-h-[52px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[16px] font-bold text-white active:bg-wm-accent-deep"
      >
        {t("confirm")}
      </button>
      <button
        type="button"
        onClick={onSkip}
        className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
      >
        {t("skip")}
      </button>
    </div>
  );
}
