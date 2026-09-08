"use client";

import { useLocale, useTranslations } from "next-intl";
import { DARB_ZONE_ORDER, zoneLabels } from "@/lib/carriers/darb-zones";

/**
 * How many parcels wait for each Darb sticker roll.
 *
 * The bench works one roll at a time: pick up the red roll, do every red
 * parcel, put it down. So the rail is the batching control, not a legend, and
 * a tap filters the list to that roll. Zeros stay visible but dimmed, so the
 * nine colours keep their places and the agent's eye learns them.
 */

export type RollKey = string | "unknown" | null;

/** Yellow and lime read as blank on a light ground without an edge. */
const FAINT = new Set(["#f9fc01", "#8fff00"]);

export function RollRail({
  counts,
  unknown,
  total,
  selected,
  onSelect,
}: {
  /** Waiting parcels per roll colour (hex). */
  counts: Record<string, number>;
  /** Parcels whose destination resolved to no roll. */
  unknown: number;
  total: number;
  selected: RollKey;
  onSelect: (key: RollKey) => void;
}) {
  const t = useTranslations("warehouse.bench");
  const locale = useLocale();

  const chip = (key: RollKey, label: string, n: number, swatch: React.ReactNode) => {
    const on = selected === key;
    return (
      <button
        key={key ?? "all"}
        type="button"
        data-testid="wh-roll"
        data-key={key ?? "all"}
        data-zero={n === 0 ? "true" : "false"}
        aria-pressed={on}
        onClick={() => onSelect(key)}
        className={[
          "inline-flex min-h-[48px] shrink-0 items-center gap-2 rounded-[12px] border px-3 text-[14px] font-semibold text-wm-ink",
          on ? "border-wm-accent bg-wm-accent-soft" : "border-wm-card-edge bg-wm-card",
          n === 0 && !on ? "opacity-45" : "",
        ].join(" ")}
      >
        {swatch}
        <span>{label}</span>
        <b className="min-w-[1.2em] text-center tabular-nums">{n}</b>
      </button>
    );
  };

  return (
    <div
      data-testid="wh-roll-rail"
      role="group"
      aria-label={t("rollsNow")}
      className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {chip(null, t("all"), total, null)}
      {DARB_ZONE_ORDER.map((hex) =>
        chip(
          hex,
          zoneLabels(hex, locale).colour ?? hex,
          counts[hex] ?? 0,
          <span
            data-testid="wh-roll-swatch"
            data-hex={hex}
            data-faint={FAINT.has(hex) ? "true" : "false"}
            aria-hidden="true"
            className={`h-[22px] w-[22px] shrink-0 rounded-[6px] ${FAINT.has(hex) ? "ring-1 ring-inset ring-wm-ink" : ""}`}
            style={{ background: hex }}
          />,
        ),
      )}
      {unknown > 0
        ? chip(
            "unknown",
            t("unknownRoll"),
            unknown,
            <span
              aria-hidden="true"
              className="h-[22px] w-[22px] shrink-0 rounded-[6px] border-2 border-dashed border-wm-ink-3"
            />,
          )
        : null}
    </div>
  );
}
