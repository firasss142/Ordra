"use client";

import { useLocale, useTranslations } from "next-intl";
import { zoneLabels } from "@/lib/carriers/darb-zones";
import type { Bucket } from "@/lib/warehouse/scan-buckets";
import { Ic } from "@/components/warehouse/desk/ui";

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
  onNext: () => void;
  onChangeMode: () => void;
  onExit: () => void;
}) {
  const t = useTranslations("warehouse.run");
  const locale = useLocale();

  const minutes = (() => {
    const [m, s] = duration.split(":").map(Number);
    return m + (s || 0) / 60;
  })();
  const rate = tally.bound > 0 && minutes > 0 ? Math.round((tally.bound / minutes) * 10) / 10 : null;
  const clean = tally.problems.length === 0 && tally.skipped === 0;
  const nextName = next ? (next.hex ? zoneLabels(next.hex, locale).colour ?? next.label : next.label) : null;

  return (
    <div data-testid="wh-run-summary" className="run-sum">
      <div className={`card run-card sum ${clean ? "ok" : "warn"}`}>
        <span className="res-ic"><Ic n={clean ? "check" : "alert"} /></span>
        <p className="res-h">{t("summaryTitle")}</p>
        <b className="sum-n num">{tally.bound}</b>
        <p className="res-why">{t("summaryBound", { n: tally.bound })}</p>
        <div className="sum-k">
          <span><Ic n="clock" />{t("summaryDuration", { time: duration })}</span>
          {rate !== null ? <span><Ic n="out" />{t("summaryRate", { n: rate })}</span> : null}
          {tally.refused > 0 ? <span className="bad"><Ic n="x" />{t("summaryRefused", { n: tally.refused })}</span> : null}
          {tally.skipped > 0 ? <span><Ic n="right" className="flip" />{t("summarySkipped", { n: tally.skipped })}</span> : null}
        </div>
      </div>

      {tally.problems.length > 0 ? (
        <div className="card run-card probs">
          <span className="eb2" style={{ color: "var(--warn)" }}><Ic n="alert" />{t("summaryRefusedTitle")}</span>
          <ul>
            {tally.problems.map((p) => (
              <li key={p.id}>
                <b><bdi>{p.name}</bdi></b>
                <span dir="auto"> — {p.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="run-acts col">
        {next ? (
          <button type="button" className="btn xl" onClick={onNext}>
            {next.hex ? <i className="dot" style={{ "--c": next.hex } as React.CSSProperties} aria-hidden="true" /> : <Ic n="scan" />}
            {t("nextBucket", { name: nextName ?? next.label })}
            <span className="bk-c">{t("bucketCount", { n: next.rows.length })}</span>
          </button>
        ) : null}
        <div className="run-acts">
          <button type="button" className="btn2 xl" onClick={onChangeMode}>
            <Ic n="list" />
            {t("changeMode")}
          </button>
          <button type="button" className="btn2 xl" onClick={onExit}>
            <Ic n="out" />
            {t("backToBench")}
          </button>
        </div>
      </div>
    </div>
  );
}
