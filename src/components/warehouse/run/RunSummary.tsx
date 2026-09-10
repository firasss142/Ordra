"use client";

import { useTranslations } from "next-intl";
import { Check, TriangleAlert } from "lucide-react";
import type { Bucket } from "@/lib/warehouse/scan-buckets";

/**
 * What the batch actually cost, and what it left behind.
 *
 * Three figures the run genuinely measured — bound, refused, skipped — plus the
 * time it took. The rate appears only when at least one parcel was bound: zero
 * per minute is not a slow agent, it is an absent measurement, and the warehouse
 * screens have a standing rule against inventing figures nobody earned.
 *
 * The refusals are LISTED, not counted. A number tells the agent something went
 * wrong; a list tells them which box is still on the table.
 */
export interface RunTally {
  bound: number;
  refused: number;
  skipped: number;
  /** Parcels that ended the batch unresolved, with the reason shown at the time. */
  problems: Array<{ id: string; name: string; message: string }>;
}

export function RunSummary({
  tally,
  duration,
  next,
  onNext,
  onChangeMode,
  onExit,
}: {
  tally: RunTally;
  /** `m:ss`, as the header counted it. */
  duration: string;
  next: Bucket | null;
  nextLabel?: string;
  onNext: () => void;
  onChangeMode: () => void;
  onExit: () => void;
}) {
  const t = useTranslations("warehouse.run");

  const minutes = (() => {
    const [m, s] = duration.split(":").map(Number);
    return m + (s || 0) / 60;
  })();
  const rate = tally.bound > 0 && minutes > 0 ? Math.round((tally.bound / minutes) * 10) / 10 : null;

  return (
    <div data-testid="wh-run-summary" className="mx-auto w-full max-w-[640px] px-4 pb-8 pt-4">
      <div className="grid place-items-center gap-2 rounded-[14px] border border-wh-ok-edge bg-wm-card p-5 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-full bg-wh-ok-bg text-wh-ok">
          <Check size={26} strokeWidth={2.5} aria-hidden="true" />
        </span>
        <p className="text-[19px] font-bold text-wm-ink">{t("summaryTitle")}</p>
        <p className="text-[32px] font-bold leading-none tabular-nums text-wm-accent">{tally.bound}</p>
        <p className="text-[14px] text-wm-ink-2">{t("summaryBound", { n: tally.bound })}</p>
        <p className="text-[13.5px] text-wm-ink-2">
          {t("summaryDuration", { time: duration })}
          {rate !== null ? ` · ${t("summaryRate", { n: rate })}` : ""}
        </p>
        {tally.refused > 0 || tally.skipped > 0 ? (
          <p className="text-[13.5px] text-wm-ink-2">
            {tally.refused > 0 ? t("summaryRefused", { n: tally.refused }) : ""}
            {tally.refused > 0 && tally.skipped > 0 ? " · " : ""}
            {tally.skipped > 0 ? t("summarySkipped", { n: tally.skipped }) : ""}
          </p>
        ) : null}
      </div>

      {tally.problems.length > 0 ? (
        <div className="mt-3 rounded-[14px] border border-wh-warn-edge bg-wh-warn-bg p-3">
          <p className="flex items-center gap-1.5 text-[13.5px] font-bold text-wh-warn">
            <TriangleAlert size={15} aria-hidden="true" />
            {t("summaryRefusedTitle")}
          </p>
          <ul className="m-0 mt-1.5 list-none p-0">
            {tally.problems.map((p) => (
              <li key={p.id} className="border-t border-wh-warn-edge/50 py-1.5 text-[13px] text-wm-ink first:border-0">
                <b><bdi>{p.name}</bdi></b>
                <span className="text-wm-ink-2"> — {p.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 grid gap-2">
        {next ? (
          <button
            type="button"
            onClick={onNext}
            className="inline-flex min-h-[52px] w-full items-center justify-center rounded-[12px] bg-wm-accent px-4 text-[15px] font-bold text-white active:bg-wm-accent-deep"
          >
            {t("nextBucket", { name: next.label })}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onChangeMode}
          className="inline-flex min-h-[48px] w-full items-center justify-center rounded-[12px] border border-wm-card-edge bg-wm-card px-4 text-[15px] font-semibold text-wm-ink"
        >
          {t("changeMode")}
        </button>
        <button
          type="button"
          onClick={onExit}
          className="inline-flex min-h-[44px] w-full items-center justify-center rounded-[12px] text-[14px] font-semibold text-wm-ink-2"
        >
          {t("backToBench")}
        </button>
      </div>
    </div>
  );
}
