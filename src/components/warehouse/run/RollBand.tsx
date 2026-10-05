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
export function RollBand({ zone }: { zone: OrderZone | null }) {
  const t = useTranslations("warehouse.bench");
  const tr = useTranslations("warehouse.run");
  const locale = useLocale();
  const labels = zoneLabels(zone, locale);
  const hex = zone?.colorHex ?? null;

  return (
    <div className="band-w">
      <div
        data-testid="wh-run-band"
        data-roll={hex ?? ""}
        className={`band ${hex ? "" : "unknown"}`}
        style={hex ? ({ "--c": hex } as React.CSSProperties) : undefined}
      >
        <span className="band-p">{hex && labels.colour ? t("roll", { colour: labels.colour }) : tr("unknownZone")}</span>
        <span data-testid="wh-run-plate" dir="ltr" className="band-p plate-lg">
          {zone?.branchGroup ?? "?"}
        </span>
      </div>
      <span className="l2" style={{ whiteSpace: "normal" }}>{hex && labels.name ? labels.name : t("unknownZoneHint")}</span>
    </div>
  );
}
