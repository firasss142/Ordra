"use client";

import { useTranslations } from "next-intl";
import type { OnTheWayRow, ReturnRow } from "@/app/api/warehouse/returns/returns-data";
import { AgeChip, Thumb, ageParts, firstName, hoursSince, isLate } from "@/components/warehouse/returns/parts";

/**
 * One returned parcel on the phone — the prototype's `.parcel` row.
 *
 * Product first (that is what the agent looks for on the shelf), then
 * « city · first name · Darb's reason », then how long Darb has held it for us,
 * amber past two days. Tapping it opens the verdict. The row is a list item in
 * a card; the card, its hairlines and the label above it belong to the screen.
 */
export function ReturnCard({ row, onOpen }: { row: ReturnRow; onOpen: (orderId: string) => void }) {
  const t = useTranslations("warehouse.returns2");
  const hours = hoursSince(row.returned_at ?? row.created_at);
  const age = ageParts(hours);
  const line = [
    row.customer_city,
    firstName(row.customer_name),
    row.darb_reason ? t(`reasons.${row.darb_reason}`) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      data-testid="wh-return-row"
      onClick={() => onOpen(row.id)}
      className="flex min-h-[64px] w-full items-center gap-[12px] px-[14px] py-[12px] text-start"
    >
      <Thumb src={row.product_image_url} size={40} icon={18} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-wh-ink-1">
          <bdi>{row.product_name}</bdi>{" "}
          <span dir="ltr" className="tabular-nums [unicode-bidi:isolate]">×{row.quantity}</span>
        </span>
        <span className="block truncate text-[12.5px] text-wh-ink-2">{line}</span>
      </span>
      <AgeChip tone={isLate(hours) ? "warn" : "mute"}>
        {age.unit === "now" ? t("ageNow") : t(age.unit === "hours" ? "ageHours" : "ageDays", { n: age.n })}
      </AgeChip>
    </button>
  );
}

/** A parcel still on its way back: same row, inert — it cannot be received yet. */
export function OnTheWayCard({ row }: { row: OnTheWayRow }) {
  const t = useTranslations("warehouse.returns2");
  return (
    <div data-testid="wh-return-onway" className="flex min-h-[64px] w-full items-center gap-[12px] px-[14px] py-[12px]">
      <Thumb src={row.product_image_url} size={40} icon={18} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-semibold text-wh-ink-1">
          <bdi>{row.product_name}</bdi>
        </div>
        <div className="text-[12.5px] text-wh-ink-2">
          {[row.customer_city, t("scanOnArrival")].filter(Boolean).join(" · ")}
        </div>
      </div>
    </div>
  );
}
