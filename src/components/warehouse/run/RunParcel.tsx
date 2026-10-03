"use client";

import { useTranslations } from "next-intl";
import { linesOf, isMixed, type RunRow } from "@/lib/warehouse/scan-buckets";
import { CARD } from "./ui";
import { Thumb } from "./RunOutcome";

/**
 * The parcel in hand (`.card.inhand`): the product large, where it goes and to
 * whom, and the quantity at a size you can read at arm's length.
 *
 * There is no "is this the parcel?" step any more — the agent took this box off
 * the table, it IS in hand. What that step guarded (a sticker on the wrong box)
 * is now guarded by this card staying on screen, above the camera, for the
 * whole scan, and by the bound card naming the product and city right after.
 *
 * EVERY LINE IS LISTED. A parcel holding three products used to render as one —
 * the denormalised product on `orders` — so a picker packed one item and the
 * sticker went on anyway.
 */
export function RunParcel({ row }: { row: RunRow }) {
  const t = useTranslations("warehouse.run");
  const lines = linesOf(row);
  const mixed = isMixed(row) || lines.length > 1;
  const units = lines.reduce((n, l) => n + (l.quantity ?? 0), 0);
  const image = lines.find((l) => l.image_url)?.image_url ?? row.product_image_url ?? null;
  const first = lines[0];

  return (
    <div data-testid="wh-run-parcel" className={`${CARD} p-[18px]`}>
      <div className="flex items-start gap-[12px]">
        <Thumb size={56} imageUrl={image} />
        <div className="min-w-0 flex-1">
          <p className="text-[20px] font-bold leading-[1.3] text-wm-ink">
            {mixed ? (
              t("linesTitle", { n: lines.length })
            ) : (
              <>
                <bdi>{first.product_name}</bdi>
                {first.variant_label ? <span className="text-wm-ink-2"> · {first.variant_label}</span> : null}
              </>
            )}
          </p>
          <p className="mt-[4px] text-[14px] text-wm-ink-2">
            {row.customer_city ? (
              <>
                <bdi>{row.customer_city}</bdi>
                {" · "}
              </>
            ) : null}
            <bdi>{row.customer_name}</bdi>
          </p>
        </div>
        <span dir="ltr" className="shrink-0 text-[34px] font-bold leading-[1.2] tabular-nums text-wm-ink">
          ×{mixed ? units : first.quantity}
        </span>
      </div>

      {mixed ? (
        <ul className="m-0 mt-[14px] list-none border-t border-line-subtle p-0 pt-[6px]">
          {lines.map((l, i) => (
            <li
              key={`${l.product_id ?? l.product_name}-${i}`}
              data-testid="wh-run-line"
              className="flex items-center gap-[10px] py-[6px]"
            >
              <span className="min-w-0 flex-1 text-[15px] font-semibold text-wm-ink">
                <bdi>{l.product_name}</bdi>
                {l.variant_label ? <span className="text-wm-ink-2"> · {l.variant_label}</span> : null}
              </span>
              <b dir="ltr" className="shrink-0 text-[16px] tabular-nums text-wm-ink">
                ×{l.quantity}
              </b>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
