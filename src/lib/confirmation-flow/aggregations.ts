import { percentileMinutes } from "@/lib/team/ttfc";
import { computeTTFCMinutes } from "@/lib/team/ttfc";

export const FUNNEL_STAGES = [
  "assigned",
  "attempt_1",
  "attempt_2",
  "attempt_3",
  "callback_scheduled",
] as const;

export type FunnelStage = (typeof FUNNEL_STAGES)[number];

// Buckets: upper bounds in minutes. Final bucket = open-ended (≥1440).
export const TTFC_BUCKETS = [0, 5, 15, 30, 60, 120, 240, 480, 1440] as const;

export interface HistoryRow {
  order_id: string;
  status_from: string | null;
  status_to: string;
  actor_id: string | null;
  created_at: string;
}

export interface OpenOrderRow {
  id: string;
  status: string;
  assigned_to: string | null;
}

export interface OverdueCallbackRow {
  id: string;
  assigned_to: string | null;
}

export interface AgentInput {
  agent_id: string;
  full_name: string;
  avatar_url: string | null;
}

export interface AgentMetrics {
  agent_id: string;
  full_name: string;
  avatar_url: string | null;
  in_attempt_3: number;
  overdue_callbacks: number;
  stuck_order_ids: string[];
  ttfc_p50_minutes: number | null;
  ttfc_p90_minutes: number | null;
  ttfc_samples: number[];
}

export interface StageTransition {
  from_stage: string;
  to_stage: string;
  count: number;
}

export interface TtfcSample {
  agent_id: string;
  ttfc: number;
}

export interface TtfcDistribution {
  bucket_minutes: readonly number[];
  counts_total: number[];
  counts_by_agent: Record<string, number[]>;
}

// ─── Open counts per funnel stage ──────────────────────────────────────────

export function computeFunnelOpenCounts(
  rows: OpenOrderRow[]
): Record<FunnelStage, number> {
  const counts = Object.fromEntries(FUNNEL_STAGES.map((s) => [s, 0])) as Record<
    FunnelStage,
    number
  >;
  for (const row of rows) {
    if ((FUNNEL_STAGES as readonly string[]).includes(row.status)) {
      counts[row.status as FunnelStage]++;
    }
  }
  return counts;
}

// ─── Stage-to-stage transition counts ──────────────────────────────────────

export function computeStageTransitions(history: HistoryRow[]): StageTransition[] {
  const map = new Map<string, number>();
  for (const row of history) {
    if (!row.status_from) continue;
    const key = `${row.status_from}→${row.status_to}`;
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return Array.from(map.entries()).map(([key, count]) => {
    const [from_stage, to_stage] = key.split("→");
    return { from_stage, to_stage, count };
  });
}

// ─── Average time spent in a stage ─────────────────────────────────────────
// Computes: for each order that entered `stage`, how many minutes until it exited.

export function computeAvgTimeInStage(
  stage: FunnelStage,
  history: HistoryRow[]
): number | null {
  // Build per-order entry/exit timestamps for this stage
  const entryAt: Record<string, string> = {};
  const exitAt: Record<string, string> = {};

  for (const row of history) {
    if (row.status_to === stage) {
      // Only record the earliest entry
      if (!entryAt[row.order_id] || row.created_at < entryAt[row.order_id]) {
        entryAt[row.order_id] = row.created_at;
      }
    }
    if (row.status_from === stage) {
      // Only record the earliest exit
      if (!exitAt[row.order_id] || row.created_at < exitAt[row.order_id]) {
        exitAt[row.order_id] = row.created_at;
      }
    }
  }

  const durations: number[] = [];
  for (const orderId of Object.keys(entryAt)) {
    const exit = exitAt[orderId];
    if (!exit) continue;
    const entry = entryAt[orderId];
    const mins = (new Date(exit).getTime() - new Date(entry).getTime()) / 60_000;
    if (mins >= 0) durations.push(mins);
  }

  if (durations.length === 0) return null;
  const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
  return Math.round(avg);
}

// ─── Per-agent metrics ──────────────────────────────────────────────────────

const MIN_TTFC_SAMPLES = 5;
const MAX_STUCK_IDS = 10;
const MAX_TTFC_SAMPLES = 100;

export function computeAgentMetrics(
  agents: AgentInput[],
  openOrders: OpenOrderRow[],
  overdueCallbacks: OverdueCallbackRow[],
  history: HistoryRow[] = []
): AgentMetrics[] {
  // Index open orders by assigned_to
  const attempt3ByAgent: Record<string, string[]> = {};
  for (const order of openOrders) {
    if (order.status === "attempt_3" && order.assigned_to) {
      if (!attempt3ByAgent[order.assigned_to]) attempt3ByAgent[order.assigned_to] = [];
      attempt3ByAgent[order.assigned_to].push(order.id);
    }
  }

  // Index overdue callbacks
  const overdueByAgent: Record<string, number> = {};
  for (const row of overdueCallbacks) {
    if (row.assigned_to) {
      overdueByAgent[row.assigned_to] = (overdueByAgent[row.assigned_to] ?? 0) + 1;
    }
  }

  // Build TTFC samples per agent from history:
  // TTFC = time from "assigned" status_to to first "attempt_*" status_to for same order/actor
  const assignedAtByOrderAgent: Record<string, string> = {};
  const firstAttemptAtByOrderAgent: Record<string, string> = {};

  for (const row of history) {
    if (!row.actor_id) continue;
    const key = `${row.order_id}:${row.actor_id}`;
    if (row.status_to === "assigned") {
      if (!assignedAtByOrderAgent[key] || row.created_at < assignedAtByOrderAgent[key]) {
        assignedAtByOrderAgent[key] = row.created_at;
      }
    }
    const isAttempt = ["attempt_1", "attempt_2", "attempt_3"].includes(row.status_to);
    if (isAttempt) {
      if (
        !firstAttemptAtByOrderAgent[key] ||
        row.created_at < firstAttemptAtByOrderAgent[key]
      ) {
        firstAttemptAtByOrderAgent[key] = row.created_at;
      }
    }
  }

  const ttfcSamplesByAgent: Record<string, number[]> = {};
  for (const key of Object.keys(assignedAtByOrderAgent)) {
    const [, agentId] = key.split(":");
    const assignedAt = assignedAtByOrderAgent[key];
    const firstAttempt = firstAttemptAtByOrderAgent[key];
    const mins = computeTTFCMinutes(assignedAt, firstAttempt ?? null);
    if (mins !== null) {
      if (!ttfcSamplesByAgent[agentId]) ttfcSamplesByAgent[agentId] = [];
      ttfcSamplesByAgent[agentId].push(mins);
    }
  }

  return agents.map((agent) => {
    const stuckIds = attempt3ByAgent[agent.agent_id] ?? [];
    const samples = ttfcSamplesByAgent[agent.agent_id] ?? [];

    const hasEnoughSamples = samples.length >= MIN_TTFC_SAMPLES;
    const downsampled =
      samples.length > MAX_TTFC_SAMPLES ? samples.slice(-MAX_TTFC_SAMPLES) : samples;

    return {
      agent_id: agent.agent_id,
      full_name: agent.full_name,
      avatar_url: agent.avatar_url,
      in_attempt_3: stuckIds.length,
      overdue_callbacks: overdueByAgent[agent.agent_id] ?? 0,
      stuck_order_ids: stuckIds.slice(0, MAX_STUCK_IDS),
      ttfc_p50_minutes: hasEnoughSamples ? percentileMinutes(samples, 50) : null,
      ttfc_p90_minutes: hasEnoughSamples ? percentileMinutes(samples, 90) : null,
      ttfc_samples: downsampled,
    };
  });
}

// ─── TTFC distribution (histogram) ─────────────────────────────────────────

export function computeTtfcDistribution(samples: TtfcSample[]): TtfcDistribution {
  const buckets = TTFC_BUCKETS;
  const numBuckets = buckets.length; // last bucket is 1440+ (open-ended)

  const countsTotal = new Array<number>(numBuckets).fill(0);
  const countsByAgent: Record<string, number[]> = {};

  function bucketIndex(mins: number): number {
    for (let i = 0; i < buckets.length - 1; i++) {
      if (mins < buckets[i + 1]) return i;
    }
    return buckets.length - 1;
  }

  for (const { agent_id, ttfc } of samples) {
    const idx = bucketIndex(ttfc);
    countsTotal[idx]++;
    if (!countsByAgent[agent_id]) countsByAgent[agent_id] = new Array<number>(numBuckets).fill(0);
    countsByAgent[agent_id][idx]++;
  }

  return { bucket_minutes: buckets, counts_total: countsTotal, counts_by_agent: countsByAgent };
}
