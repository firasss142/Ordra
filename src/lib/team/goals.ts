/**
 * Goals ("Objectifs") — the pure logic behind the team control room.
 *
 * Three daily objectives per agent, always the same:
 *   volume   — treated ≥ dailyTreated
 *   quality  — confirmed / treated ≥ minRate, evaluated only once ≥ MIN_TREATED_FOR_RATE
 *              treated that day (before that it is "pending", never a miss)
 *   hygiene  — 0 overdue callbacks and 0 orders > 24 h without an attempt in the
 *              agent's own file
 *
 * A "série" is the number of consecutive ACTIVE days at 3/3. Days with no
 * activity are skipped, not broken — a day off is not a failed day.
 *
 * Ranking is on confirmations per active hour: it fuses quality and speed and
 * needs no model. Agents with too little activity are listed, not ranked.
 *
 * Everything here is deterministic and unit-tested; the SQL RPCs supply the
 * counts, this file supplies the judgement.
 */

export interface GoalTargets {
  /** Treated orders per local day. */
  dailyTreated: number;
  /** Confirmation rate on treated, percent. */
  minRate: number;
  /** Weekly ranking target, confirmations per active hour. */
  confPerHour: number;
}

export const DEFAULT_GOAL_TARGETS: GoalTargets = {
  dailyTreated: 12,
  minRate: 40,
  confPerHour: 3,
};

/** Below this many treated, a rate is noise and is neither shown nor judged. */
export const MIN_TREATED_FOR_RATE = 10;
/** Below this much activity an agent is listed but not ranked. */
export const MIN_ACTIVE_MINUTES_FOR_RANK = 60;

export interface DailyGoalInput {
  treated: number;
  confirmed: number;
  overdueCallbacks: number;
  staleUntouched: number;
}

export interface GoalCheck<V = number> {
  value: V;
  target: number;
  /** true = atteint, false = manqué, null = en cours (not yet judgeable) */
  met: boolean | null;
}

export interface DailyGoalsResult {
  volume: GoalCheck<number>;
  quality: GoalCheck<number | null>;
  hygiene: GoalCheck<number>;
  /** How many of the three are met (pending counts as not met). */
  metCount: number;
  /** No activity at all today. */
  idle: boolean;
}

export function rateOf(confirmed: number, treated: number): number | null {
  if (treated <= 0) return null;
  return Math.round((confirmed / treated) * 1000) / 10;
}

export function evaluateDailyGoals(input: DailyGoalInput, targets: GoalTargets): DailyGoalsResult {
  const volumeMet = input.treated >= targets.dailyTreated;
  const judgeable = input.treated >= MIN_TREATED_FOR_RATE;
  const rate = judgeable ? rateOf(input.confirmed, input.treated) : null;
  const qualityMet = judgeable && rate !== null ? rate >= targets.minRate : null;
  const hygieneIssues = input.overdueCallbacks + input.staleUntouched;
  const hygieneMet = hygieneIssues === 0;
  const metCount = (volumeMet ? 1 : 0) + (qualityMet ? 1 : 0) + (hygieneMet ? 1 : 0);
  return {
    volume: { value: input.treated, target: targets.dailyTreated, met: volumeMet },
    quality: { value: rate, target: targets.minRate, met: qualityMet },
    hygiene: { value: hygieneIssues, target: 0, met: hygieneMet },
    metCount,
    idle: input.treated === 0 && input.confirmed === 0,
  };
}

/**
 * Consecutive active days at 3/3, oldest → newest. Historical hygiene is not
 * reconstructible from the event log, so callers pass 0 for past days and the
 * streak is effectively volume + quality — documented, deliberate.
 */
export function computeGoalStreak(
  daysOldestFirst: DailyGoalInput[],
  targets: GoalTargets,
): { current: number; best: number } {
  let current = 0;
  let best = 0;
  for (const day of daysOldestFirst) {
    const isActive = day.treated > 0 || day.confirmed > 0;
    if (!isActive) continue;
    const r = evaluateDailyGoals(day, targets);
    if (r.metCount === 3) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 0;
    }
  }
  return { current, best };
}

export function confirmationsPerHour(confirmed: number, activeMinutes: number): number | null {
  if (activeMinutes <= 0) return null;
  return Math.round((confirmed / (activeMinutes / 60)) * 100) / 100;
}

export interface RankInput {
  agentId: string;
  confirmed: number;
  activeMinutes: number;
  treated: number;
}

export type UnrankedReason = "no_activity" | "too_little_activity";

export interface RankedAgent extends RankInput {
  rank: number;
  confPerHour: number;
}

export interface UnrankedAgent extends RankInput {
  reason: UnrankedReason;
}

export function rankAgents(agents: RankInput[]): { ranked: RankedAgent[]; unranked: UnrankedAgent[] } {
  const ranked: RankedAgent[] = [];
  const unranked: UnrankedAgent[] = [];
  for (const a of agents) {
    if (a.activeMinutes === 0 && a.treated === 0) {
      unranked.push({ ...a, reason: "no_activity" });
      continue;
    }
    if (a.activeMinutes < MIN_ACTIVE_MINUTES_FOR_RANK || a.treated < MIN_TREATED_FOR_RATE) {
      unranked.push({ ...a, reason: "too_little_activity" });
      continue;
    }
    ranked.push({ ...a, rank: 0, confPerHour: confirmationsPerHour(a.confirmed, a.activeMinutes) ?? 0 });
  }
  // stable sort: JS Array.prototype.sort is stable, ties keep insertion order
  ranked.sort((x, y) => y.confPerHour - x.confPerHour);
  ranked.forEach((r, i) => {
    r.rank = i + 1;
  });
  return { ranked, unranked };
}

export interface CoachingSuggestion {
  metric: "rate" | "throughput";
  value: number;
}

/**
 * The coaching CTA names the agent's weakest component: the rate when it sits
 * under the quality goal, otherwise throughput — one notch above the agent's
 * own current pace (ceil + 1). A step, not a leap: an agent at 2/h is asked
 * for 3/h, not for the team median.
 */
export function suggestCoachingTarget(
  agent: { rate: number | null; throughput: number | null },
  team: { minRate: number; medianThroughput: number },
): CoachingSuggestion | null {
  if (agent.rate === null || agent.throughput === null) return null;
  if (agent.rate < team.minRate) return { metric: "rate", value: team.minRate };
  return { metric: "throughput", value: Math.ceil(agent.throughput) + 1 };
}

export function formatActiveMinutes(minutes: number): string {
  if (minutes <= 0) return "0 h";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} h`;
  return `${h} h ${String(m).padStart(2, "0")}`;
}
