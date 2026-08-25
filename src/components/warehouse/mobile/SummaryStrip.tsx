"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { WhSpark } from "@/components/warehouse/console/WhSpark";
import { WmCard } from "./primitives";

/**
 * The "Interactive Summary" strip (mockup 01) — three cells, one card.
 *
 * The mockup prints 120/hr, 99.5 % and 65 with no qualification. Every one of
 * those is NULL in this warehouse: nobody has ever scanned and nobody has ever
 * counted. The component's whole job is to say so rather than print a zero
 * that reads as a measurement.
 *
 * Note the asymmetry, which is deliberate:
 *   · a RATE of zero would claim the agent is standing still → "—"
 *   · a COUNT of zero in the last hour is a true observation → "0"
 */

/** Below this an accuracy percentage is arithmetic, not a measurement. */
const THIN_SAMPLE = 5;

function Cell({
  id,
  label,
  value,
  unit,
  note,
  series,
}: {
  id: string;
  label: string;
  value: ReactNode;
  unit?: string;
  note?: string;
  series: number[];
}) {
  return (
    // The testid covers the whole cell, value and caveat together: what this
    // cell CLAIMS is the figure plus the note qualifying it, and a test that
    // reads only the number would pass on a figure with its caveat missing.
    <div data-testid={id} className="min-w-0 flex-1 px-2.5 py-3 text-center">
      <div className="truncate text-[12px] text-wm-ink">{label}</div>
      <div className="mt-1.5 flex items-baseline justify-center gap-0.5 text-[20px] font-extrabold tabular-nums text-wm-ink">
        {value}
        {unit ? <span className="text-[11px] font-bold text-wm-ink-2">{unit}</span> : null}
      </div>
      {note ? (
        // Never truncated: the note is what stops the figure being read as a
        // measurement, so clipping it defeats the cell.
        <div className="mt-1 text-[10.5px] leading-tight text-wm-ink-2">{note}</div>
      ) : null}
      <div className="mt-2.5 text-wm-accent">
        {/* Taller than the console's sparkline: in the mockup this chart is
            the bottom half of the cell, not a footnote under the figure. */}
        <WhSpark values={series} height="h-[34px]" emptyBaseline />
      </div>
    </div>
  );
}

export function SummaryStrip({
  ratePerHour,
  accuracy,
  scansLastHour,
  hourly,
  accuracyHistory,
  countedProducts,
}: {
  /** Scans per hour PRESENT. Null when nothing was scanned today. */
  ratePerHour: number | null;
  /** Accuracy of the last physical counts. Null when nobody has counted. */
  accuracy: number | null;
  scansLastHour: number;
  /** Scans per hour of the local day, for the cadence line. */
  hourly: number[];
  /** Accuracy of recent counts, oldest first. */
  accuracyHistory: number[];
  /** How many products the accuracy figure rests on. */
  countedProducts: number;
}) {
  const t = useTranslations("warehouse.dash");

  const thin = accuracy !== null && countedProducts > 0 && countedProducts < THIN_SAMPLE;

  return (
    <WmCard className="flex divide-x divide-wm-card-edge rtl:divide-x-reverse">
      <Cell
        id="wm-speed"
        label={t("speed")}
        value={ratePerHour === null ? "—" : ratePerHour}
        unit={ratePerHour === null ? undefined : t("perHour")}
        note={ratePerHour === null ? t("noScansToday") : undefined}
        series={hourly}
      />
      <Cell
        id="wm-accuracy"
        label={t("accuracy")}
        value={accuracy === null ? "—" : accuracy}
        unit={accuracy === null ? undefined : "%"}
        note={
          accuracy === null
            ? t("noCounts")
            : thin
              ? t("thinSample", { n: countedProducts })
              : undefined
        }
        series={accuracyHistory}
      />
      <Cell
        id="wm-lasthour"
        label={t("lastHour")}
        // A count has a true zero, unlike a rate: "nobody scanned in the last
        // hour" is an observation, not an absence of one.
        value={scansLastHour}
        series={hourly.slice(-6)}
      />
    </WmCard>
  );
}
