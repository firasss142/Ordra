"use client";

import { useLocale, useTranslations } from "next-intl";
import { zoneLabels } from "@/lib/carriers/darb-zones";
import type { OrderZone } from "@/lib/warehouse/zone-index";

/**
 * The colour to reach for, at arm's length.
 *
 * Darb routes by the colour of a pre-printed sticker and binds whatever number
 * it is given, so a wrong roll ships the parcel to the wrong city and nothing
 * downstream catches it. The band is therefore the loudest thing on the screen,
 * and it obeys the rules in plans/warehouse-agent-ux-critique.md §3.7:
 *
 *   · the hex is Darb's, unmodified — the agent matches it against a physical
 *     roll, so a tint or an opacity would be a different colour;
 *   · NO text sits on the hue. Measured across the nine published colours, no
 *     ink clears AA on #339307, and a tint plate ranges from 1.1:1 to 12.9:1.
 *     Both plates are solid white: 16.97:1 on every colour;
 *   · the colour never travels alone — its name and the branch code ride with it.
 */
export function RollBand({ zone, big = false }: { zone: OrderZone | null; big?: boolean }) {
  const t = useTranslations("warehouse.bench");
  const tr = useTranslations("warehouse.run");
  const locale = useLocale();
  const labels = zoneLabels(zone, locale);
  const hex = zone?.colorHex ?? null;

  return (
    <div>
      <div
        data-testid="wh-run-band"
        data-roll={hex ?? ""}
        className={`flex items-center gap-3 rounded-[12px] px-3.5 ${big ? "min-h-[64px]" : "min-h-[56px]"} ${
          hex ? "border border-black/10" : "border-2 border-dashed border-wm-ink-3"
        }`}
        style={{ background: hex ?? "transparent" }}
      >
        <span className="min-w-0 flex-1 truncate rounded-[8px] bg-white px-3 py-1 text-[16px] font-bold text-wm-ink">
          {hex && labels.colour ? t("roll", { colour: labels.colour }) : tr("unknownZone")}
        </span>
        <span
          data-testid="wh-run-plate"
          dir="ltr"
          className="shrink-0 rounded-[6px] bg-white px-2.5 py-0.5 text-[15px] font-bold tracking-[0.04em] text-wm-ink"
        >
          {zone?.branchGroup ?? "?"}
        </span>
      </div>
      <p className="mt-1.5 px-0.5 text-[14px] text-wm-ink-2">
        {hex && labels.name ? labels.name : t("unknownZoneHint")}
      </p>
    </div>
  );
}
