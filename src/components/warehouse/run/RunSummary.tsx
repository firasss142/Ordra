"use client";

import { useTranslations } from "next-intl";
import { Check, TriangleAlert } from "lucide-react";
import type { Bucket } from "@/lib/warehouse/scan-buckets";
import { BTN_GHOST, BTN_PRI, BTN_SEC } from "./ui";

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
    <div data-testid="wh-run-summary" className="mx-auto w-full max-w-[640px] px-[16px] pb-[32px] pt-[16px]">
      <div className="grid place-items-center gap-[8px] rounded-[16px] border border-wh-ok-edge bg-white p-[20px] text-center">
        <span className="grid h-[48px] w-[48px] place-items-center rounded-full bg-wh-ok-bg text-wh-ok">
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
        <div className="mt-[12px] rounded-[16px] border border-wh-warn-edge bg-wh-warn-bg p-[12px]">
          <p className="flex items-center gap-[6px] text-[13.5px] font-bold text-wh-warn">
            <TriangleAlert size={15} aria-hidden="true" />
            {t("summaryRefusedTitle")}
          </p>
          <ul className="m-0 mt-[6px] list-none p-0">
            {tally.problems.map((p) => (
              <li key={p.id} className="border-t border-wh-warn-edge/50 py-[6px] text-[13px] text-wm-ink first:border-0">
                <b><bdi>{p.name}</bdi></b>
                <span className="text-wm-ink-2"> — {p.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-[16px] grid gap-[8px]">
        {next ? (
          <button
            type="button"
            onClick={onNext}
            className={`${BTN_PRI} w-full`}
          >
            {t("nextBucket", { name: next.label })}
          </button>
        ) : null}
        <button
          type="button"
          onClick={onChangeMode}
          className={`${BTN_SEC} w-full`}
        >
          {t("changeMode")}
        </button>
        <button
          type="button"
          onClick={onExit}
          className={`${BTN_GHOST} w-full`}
        >
          {t("backToBench")}
        </button>
      </div>
    </div>
  );
}
