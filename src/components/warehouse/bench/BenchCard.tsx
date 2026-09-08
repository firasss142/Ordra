"use client";

import { useTranslations } from "next-intl";
import { Clock, Package } from "lucide-react";
import { benchAgeLabel, type PrepRow } from "@/components/warehouse/console/PrepCard";

/**
 * One parcel on the bench, as the phone shows it.
 *
 * What the agent matches against the physical box (customer, product,
 * quantity, city), what decides the roll (the colour bar on the leading
 * edge), how long it has waited (amber past two days), and one 48px action.
 * The colour never carries text: the roll name lives on the group header,
 * the bar is only a bar.
 */

/** Carrier states that mean the parcel has already left. It cannot be scanned. */
const GONE_AT_CARRIER = new Set(["released", "completed", "returning", "returned"]);

export function BenchCard({
  row,
  isLy,
  held,
  currency,
  onTake,
}: {
  row: PrepRow;
  isLy: boolean;
  held: boolean;
  currency: string;
  onTake: (row: PrepRow) => void;
}) {
  const t = useTranslations("warehouse.bench");
  const tp = useTranslations("warehouse.prep2");
  const tAge = useTranslations("warehouse.age");

  const hex = isLy ? (row.zone.colorHex ?? "") : "";
  const since = row.uploaded_at ?? row.created_at;
  const hours = Math.max(0, (Date.now() - new Date(since).getTime()) / 3_600_000);
  const late = hours >= 48;
  const gone = GONE_AT_CARRIER.has(row.carrier_status_slug ?? "");
  const unbindable = isLy && !gone && row.has_carrier_ref === false;
  const stock = row.current_stock ?? 0;
  const low = stock <= (row.low_stock_threshold ?? 0);

  return (
    <article
      data-testid="wh-bench-card"
      data-held={held ? "true" : "false"}
      data-roll={hex}
      className={`relative rounded-[14px] border bg-wm-card p-3 ${hex ? "ps-[18px]" : ""} ${
        held ? "border-wm-accent shadow-[inset_0_0_0_1px_var(--wm-accent)]" : "border-wm-card-edge"
      }`}
    >
      {hex ? (
        <span
          aria-hidden="true"
          className="absolute inset-y-0 start-0 w-[6px] rounded-s-[13px]"
          style={{ background: hex }}
        />
      ) : null}

      <div className="flex items-center gap-2.5">
        <span
          data-testid="wh-bench-thumb"
          aria-hidden="true"
          className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-wm-card-edge bg-wm-ground text-wm-ink-3"
        >
          {row.product_image_url ? (
            // Raw <img>: the project configures no images.remotePatterns.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.product_image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : (
            <Package size={18} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[16px] font-bold leading-tight text-wm-ink">
            <bdi>{row.customer_name}</bdi>
          </b>
          <span className="block truncate text-[13.5px] text-wm-ink-2">
            <bdi>{row.product_name}</bdi>
            {row.variant_label ? ` · ${row.variant_label}` : ""} × {row.quantity}
            {row.customer_city ? (
              <>
                {" · "}
                <bdi>{row.customer_city}</bdi>
              </>
            ) : null}
          </span>
        </div>
        <span
          data-testid="wh-bench-age"
          data-late={late ? "true" : "false"}
          title={tp("ageFromUpload")}
          className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-pill border px-2 py-0.5 text-[12.5px] tabular-nums ${
            late
              ? "border-wh-warn-edge bg-wh-warn-bg font-bold text-wh-warn"
              : "border-wm-card-edge bg-wm-card text-wm-ink-2"
          }`}
        >
          <Clock size={12} aria-hidden="true" />
          {benchAgeLabel(hours, tAge)}
        </span>
      </div>

      {gone || unbindable ? (
        <p className={`mt-2 text-[12.5px] font-semibold ${gone ? "text-wh-bad" : "text-wh-warn"}`}>
          {gone ? tp("goneAtCarrier") : tp("noCarrierRef")}
        </p>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between gap-2.5">
        <span className="min-w-0 text-[13.5px] text-wm-ink-2">
          <span className="font-bold tabular-nums text-wm-ink" dir="ltr">
            {Number(row.total_price).toFixed(2)}
            <small className="ms-1 text-[11px] font-semibold text-wm-ink-2">{currency}</small>
          </span>
          {" · "}
          <span
            data-testid="wh-bench-stock"
            data-low={low ? "true" : "false"}
            className={low ? "font-semibold text-wh-warn" : ""}
          >
            {t("inStock", { n: stock })}
            {low ? ` · ${t("lowStock")}` : ""}
          </span>
        </span>
        {held ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-pill border border-wm-accent bg-wm-accent-soft px-3 py-1 text-[13px] font-bold text-wm-accent">
            {t("inHand")}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => onTake(row)}
            disabled={gone}
            className="inline-flex min-h-[48px] shrink-0 items-center whitespace-nowrap rounded-[12px] border border-wm-accent bg-wm-accent px-4 text-[15px] font-bold text-white active:bg-wm-accent-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {t("take")}
          </button>
        )}
      </div>
    </article>
  );
}
