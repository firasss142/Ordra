/**
 * The judgement layer for one agent-day. SQL (get_agent_day_detail) supplies
 * counts; this file decides what they mean. Pure and unit-tested, same split as
 * goals.ts — one place to change a rule, one place to test it.
 *
 * Two opinions are baked in here, both forced by production data:
 *
 *   1. UPLOAD IS THE OUTCOME. A confirmation that never reaches the carrier
 *      earns nothing, so the headline yield is uploaded/treated, not
 *      confirmed/treated. On a real day those were 25 % and 46 %.
 *
 *   2. LATE AND ABANDONED ARE DIFFERENT FAILURES. A follow-up 3 h after the
 *      last one is a pace problem; one 3 days after is an order nobody owns.
 *      Collapsing both into "> 2 h" hid that, so the tier survives into the UI.
 */

import type {
  AgentDayDetail,
  DayCadence,
  DayHour,
  DayProduct,
  DayQueue,
  DayTotals,
} from "./types";
import { MIN_TREATED_FOR_RATE, computeGoalStreak, rateOf, type GoalTargets } from "./goals";

/** A follow-up call is expected within this many minutes of the previous one. */
export const CADENCE_SLA_MIN = 120;
/** Past this, the order was not "called late" — it was left behind. */
export const CADENCE_ABANDON_MIN = 1440;

export type CadenceTier = "ok" | "late" | "abandoned";

export function cadenceTier(gapMin: number): CadenceTier {
  if (gapMin <= CADENCE_SLA_MIN) return "ok";
  if (gapMin <= CADENCE_ABANDON_MIN) return "late";
  return "abandoned";
}

export type Tone = "ok" | "warn" | "bad";
export type QueueBand = "exhausted" | "lastChance" | "healthy";

/** Attempts left at or below this (but above 0) means one more shot. */
const LAST_CHANCE_MAX = 2;

export function queueBand(attemptsLeft: number): QueueBand {
  if (attemptsLeft <= 0) return "exhausted";
  if (attemptsLeft <= LAST_CHANCE_MAX) return "lastChance";
  return "healthy";
}

export interface HourCell extends DayHour {
  /** Late follow-ups the agent actually handled in this hour. */
  lateCallbacks: number;
}

export interface DayProductView extends DayProduct {
  /** confirmed/treated — null below MIN_TREATED_FOR_RATE, where a rate is noise. */
  confirmRate: number | null;
  /** uploaded/treated — the yield that actually shipped. */
  uploadRate: number | null;
}

export interface QueueBucketView {
  attemptsLeft: number;
  n: number;
  band: QueueBand;
}

export interface QueueView {
  open: number;
  uploaded: number;
  rejected: number;
  exhausted: number;
  lastChance: number;
  healthy: number;
  buckets: QueueBucketView[];
}

export type TakeawayKind = "cadence" | "vague_reason" | "stuck" | "open_queue";

export interface Takeaway {
  kind: TakeawayKind;
  tone: Tone;
  /** For cadence: which of the two failure shapes this day has. */
  variant?: CadenceTier;
  /** The figure the row is about, when it has one. */
  count?: number;
  /** Percentage the row is about, when it has one. */
  pct?: number;
  /** Minutes the row is about, when it has one. */
  minutes?: number | null;
}

export interface AgentDayView {
  day: string;
  agentId: string | null;
  agentName: string;
  avatarUrl: string | null;
  totals: DayTotals;
  targets: AgentDayDetail["targets"];
  /** confirmed / treated, percent. Null when nothing was treated. */
  confirmRate: number | null;
  /** uploaded / treated, percent — the honest yield. */
  uploadRate: number | null;
  /** uploadRate minus the market's quality target, in percentage points. */
  signatureDelta: number | null;
  /** Uploads per active hour — the rhythm the ranking is built on. */
  uploadsPerHour: number | null;
  /** How many logged actions it took to ship one order. */
  callsPerUpload: number | null;
  /** Consecutive active days at 3/3, over the 14-day series ending on this day. */
  streak: { current: number; best: number };
  hours: HourCell[];
  products: DayProductView[];
  motifs: { reason: string; n: number }[];
  cadence: DayCadence & { tier: CadenceTier | null };
  queue: QueueView;
  series: AgentDayDetail["series"];
  takeaways: Takeaway[];
}

function streakTargets(t: AgentDayDetail["targets"]): GoalTargets {
  return { dailyTreated: t.daily_treated, minRate: t.min_rate, confPerHour: t.conf_per_hour };
}

function perHour(count: number, activeMinutes: number): number | null {
  if (activeMinutes <= 0) return null;
  return Math.round((count / (activeMinutes / 60)) * 100) / 100;
}

export function buildAgentDayView(detail: AgentDayDetail): AgentDayView {
  const totals: DayTotals = detail.totals;
  const targets = detail.targets;

  const confirmRate = rateOf(totals.confirmed, totals.treated);
  const uploadRate = rateOf(totals.uploaded, totals.treated);
  const signatureDelta =
    uploadRate === null ? null : Math.round((uploadRate - targets.min_rate) * 10) / 10;

  // 24 fixed cells so the strip is an axis, not a sparse list.
  const byHour = new Map(detail.hourly.map((h) => [h.hour, h]));
  const hours: HourCell[] = Array.from({ length: 24 }, (_, hour) => {
    const h = byHour.get(hour);
    return {
      hour,
      active_minutes: h?.active_minutes ?? 0,
      treated: h?.treated ?? 0,
      confirmed: h?.confirmed ?? 0,
      lateCallbacks: detail.late_hours?.[String(hour)] ?? 0,
    };
  });

  const products: DayProductView[] = detail.products.map((p) => {
    const judgeable = p.treated >= MIN_TREATED_FOR_RATE;
    return {
      ...p,
      confirmRate: judgeable ? rateOf(p.confirmed, p.treated) : null,
      uploadRate: judgeable ? rateOf(p.uploaded, p.treated) : null,
    };
  });

  const queue = buildQueueView(detail.queue_end_of_day, targets.max_attempts);

  const median = detail.cadence.median_gap_min;
  const tier = median === null || detail.cadence.judged === 0 ? null : cadenceTier(median);

  return {
    day: detail.day,
    agentId: detail.agent?.agent_id ?? null,
    agentName: detail.agent?.name ?? "",
    avatarUrl: detail.agent?.avatar_url ?? null,
    totals,
    targets,
    confirmRate,
    uploadRate,
    signatureDelta,
    uploadsPerHour: perHour(totals.uploaded, totals.active_minutes),
    callsPerUpload: totals.uploaded > 0 ? Math.round((totals.calls / totals.uploaded) * 10) / 10 : null,
    // Historical hygiene is not reconstructible from the event log, so the
    // streak is volume + quality only — the same documented compromise
    // computeGoalStreak already makes on the performance page.
    streak: computeGoalStreak(
      detail.series.map((s) => ({
        treated: s.treated,
        confirmed: s.confirmed,
        overdueCallbacks: 0,
        staleUntouched: 0,
      })),
      streakTargets(targets),
    ),
    hours,
    products,
    motifs: detail.motifs,
    cadence: { ...detail.cadence, tier },
    queue,
    series: detail.series,
    takeaways: buildTakeaways(totals, detail.motifs, tier, median, queue),
  };
}

function buildQueueView(q: DayQueue, maxAttempts: number): QueueView {
  const byLeft = new Map(q.by_attempts_left.map((b) => [b.attempts_left, b.n]));
  const span = Math.max(maxAttempts, ...q.by_attempts_left.map((b) => b.attempts_left), 0);
  const buckets: QueueBucketView[] = Array.from({ length: span + 1 }, (_, attemptsLeft) => ({
    attemptsLeft,
    n: byLeft.get(attemptsLeft) ?? 0,
    band: queueBand(attemptsLeft),
  }));
  const sum = (band: QueueBand) =>
    buckets.filter((b) => b.band === band).reduce((s, b) => s + b.n, 0);
  return {
    open: q.open,
    uploaded: q.uploaded,
    rejected: q.rejected,
    exhausted: sum("exhausted"),
    lastChance: sum("lastChance"),
    healthy: sum("healthy"),
    buckets,
  };
}

function buildTakeaways(
  totals: DayTotals,
  motifs: { reason: string; n: number }[],
  tier: CadenceTier | null,
  median: number | null,
  queue: QueueView,
): Takeaway[] {
  const out: Takeaway[] = [];

  if (tier) {
    out.push({
      kind: "cadence",
      tone: tier === "abandoned" ? "bad" : tier === "late" ? "warn" : "ok",
      variant: tier,
      minutes: median,
    });
  }

  if (motifs.length > 0) {
    const total = motifs.reduce((s, m) => s + m.n, 0);
    const vague = motifs.find((m) => m.reason === "autre" || m.reason === "unknown");
    const share = total > 0 ? ((vague?.n ?? 0) / total) * 100 : 0;
    out.push({
      kind: "vague_reason",
      tone: share > 50 ? "bad" : "ok",
      pct: Math.round(share * 10) / 10,
    });
  }

  // Confirmed and never shipped is the only failure here that is pure loss:
  // the customer said yes and nothing was sent.
  if (totals.stuck_confirmed > 0) {
    out.push({ kind: "stuck", tone: "bad", count: totals.stuck_confirmed });
  }

  if (queue.open > 0) {
    out.push({
      kind: "open_queue",
      tone: queue.exhausted > 0 ? "bad" : "warn",
      count: queue.open,
    });
  }

  return out;
}
