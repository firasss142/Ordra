"use client";

import type { DailyGoalsResult } from "@/lib/team/goals";

interface Props {
  goals: DailyGoalsResult;
  /** No activity at all — render the empty grey track. */
  muted?: boolean;
  title?: string;
}

function tone(met: boolean | null, muted: boolean): string {
  if (muted) return "bg-[#EEF0F2]";
  if (met === true) return "bg-status-success";
  if (met === false) return "bg-status-critical";
  return "bg-status-warning";
}

/** Three 34×7 segments — volume · qualité · hygiène — plus "n/3". */
export function GoalSegments({ goals, muted = false, title }: Props) {
  const segs = [goals.volume.met, goals.quality.met, goals.hygiene.met];
  return (
    <span className="inline-flex items-center gap-1.5" title={title}>
      {segs.map((met, i) => (
        <i key={i} className={`block h-[7px] w-[34px] rounded-[4px] ${tone(met, muted)}`} />
      ))}
      <span className={`ms-1.5 text-[13px] tabular-nums ${muted ? "text-ink-muted" : "text-ink-secondary"}`}>
        {goals.metCount}/3
      </span>
    </span>
  );
}
