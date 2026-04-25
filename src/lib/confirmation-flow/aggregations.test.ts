import { describe, it, expect } from "vitest";
import {
  computeFunnelOpenCounts,
  computeStageTransitions,
  computeAvgTimeInStage,
  computeAgentMetrics,
  computeTtfcDistribution,
  TTFC_BUCKETS,
  FUNNEL_STAGES,
  type FunnelStage,
  type HistoryRow,
  type OpenOrderRow,
  type OverdueCallbackRow,
} from "./aggregations";

// ─── helpers ───────────────────────────────────────────────────────────────

function iso(offset: number, base = "2026-04-24T12:00:00.000Z"): string {
  const d = new Date(base);
  d.setMinutes(d.getMinutes() + offset);
  return d.toISOString();
}

// ─── computeFunnelOpenCounts ────────────────────────────────────────────────

describe("computeFunnelOpenCounts", () => {
  it("returns zero for each stage when no open orders", () => {
    const counts = computeFunnelOpenCounts([]);
    expect(FUNNEL_STAGES.every((s) => counts[s] === 0)).toBe(true);
  });

  it("counts open orders per stage", () => {
    const rows: OpenOrderRow[] = [
      { id: "o1", status: "assigned", assigned_to: "a1" },
      { id: "o2", status: "attempt_1", assigned_to: "a1" },
      { id: "o3", status: "attempt_1", assigned_to: "a2" },
      { id: "o4", status: "attempt_3", assigned_to: "a1" },
    ];
    const counts = computeFunnelOpenCounts(rows);
    expect(counts.assigned).toBe(1);
    expect(counts.attempt_1).toBe(2);
    expect(counts.attempt_2).toBe(0);
    expect(counts.attempt_3).toBe(1);
    expect(counts.callback_scheduled).toBe(0);
  });

  it("ignores statuses outside the funnel", () => {
    const rows: OpenOrderRow[] = [
      { id: "o1", status: "confirmed", assigned_to: "a1" },
      { id: "o2", status: "dispatched", assigned_to: "a1" },
    ];
    const counts = computeFunnelOpenCounts(rows);
    expect(FUNNEL_STAGES.every((s) => counts[s] === 0)).toBe(true);
  });
});

// ─── computeStageTransitions ────────────────────────────────────────────────

describe("computeStageTransitions", () => {
  it("returns empty array when no history", () => {
    expect(computeStageTransitions([])).toEqual([]);
  });

  it("counts each from→to pair", () => {
    const history: HistoryRow[] = [
      { order_id: "o1", status_from: "assigned", status_to: "attempt_1", actor_id: "a1", created_at: iso(0) },
      { order_id: "o2", status_from: "assigned", status_to: "attempt_1", actor_id: "a1", created_at: iso(1) },
      { order_id: "o3", status_from: "attempt_1", status_to: "confirmed", actor_id: "a1", created_at: iso(2) },
    ];
    const transitions = computeStageTransitions(history);
    const a1 = transitions.find((t) => t.from_stage === "assigned" && t.to_stage === "attempt_1");
    expect(a1?.count).toBe(2);
    const a2 = transitions.find((t) => t.from_stage === "attempt_1" && t.to_stage === "confirmed");
    expect(a2?.count).toBe(1);
  });

  it("skips rows with null status_from", () => {
    const history: HistoryRow[] = [
      { order_id: "o1", status_from: null, status_to: "assigned", actor_id: "a1", created_at: iso(0) },
    ];
    expect(computeStageTransitions(history)).toEqual([]);
  });
});

// ─── computeAvgTimeInStage ──────────────────────────────────────────────────

describe("computeAvgTimeInStage", () => {
  it("returns null for a stage with no exits", () => {
    // o1 entered assigned but never left
    const history: HistoryRow[] = [
      { order_id: "o1", status_from: null, status_to: "assigned", actor_id: "a1", created_at: iso(0) },
    ];
    expect(computeAvgTimeInStage("assigned", history)).toBeNull();
  });

  it("computes average time from entry to first exit for a stage", () => {
    // o1 entered assigned at t=0, left at t=30
    // o2 entered assigned at t=0, left at t=60
    const history: HistoryRow[] = [
      { order_id: "o1", status_from: null, status_to: "assigned", actor_id: null, created_at: iso(0) },
      { order_id: "o1", status_from: "assigned", status_to: "attempt_1", actor_id: "a1", created_at: iso(30) },
      { order_id: "o2", status_from: null, status_to: "assigned", actor_id: null, created_at: iso(0) },
      { order_id: "o2", status_from: "assigned", status_to: "attempt_1", actor_id: "a1", created_at: iso(60) },
    ];
    const avg = computeAvgTimeInStage("assigned", history);
    expect(avg).toBe(45); // (30 + 60) / 2
  });
});

// ─── computeAgentMetrics ────────────────────────────────────────────────────

describe("computeAgentMetrics", () => {
  const agents = [
    { agent_id: "a1", full_name: "Alice", avatar_url: null },
    { agent_id: "a2", full_name: "Bob", avatar_url: null },
  ];

  it("returns zero metrics for agents with no activity", () => {
    const metrics = computeAgentMetrics(agents, [], []);
    expect(metrics[0].in_attempt_3).toBe(0);
    expect(metrics[0].overdue_callbacks).toBe(0);
    expect(metrics[0].stuck_order_ids).toEqual([]);
  });

  it("counts in_attempt_3 from open orders", () => {
    const open: OpenOrderRow[] = [
      { id: "o1", status: "attempt_3", assigned_to: "a1" },
      { id: "o2", status: "attempt_3", assigned_to: "a1" },
      { id: "o3", status: "attempt_3", assigned_to: "a2" },
    ];
    const metrics = computeAgentMetrics(agents, open, []);
    const alice = metrics.find((m) => m.agent_id === "a1")!;
    const bob = metrics.find((m) => m.agent_id === "a2")!;
    expect(alice.in_attempt_3).toBe(2);
    expect(bob.in_attempt_3).toBe(1);
  });

  it("counts overdue_callbacks from overdue rows", () => {
    const overdue: OverdueCallbackRow[] = [
      { id: "o1", assigned_to: "a1" },
      { id: "o2", assigned_to: "a1" },
    ];
    const metrics = computeAgentMetrics(agents, [], overdue);
    const alice = metrics.find((m) => m.agent_id === "a1")!;
    expect(alice.overdue_callbacks).toBe(2);
  });

  it("caps stuck_order_ids at 10", () => {
    const open: OpenOrderRow[] = Array.from({ length: 15 }, (_, i) => ({
      id: `o${i}`,
      status: "attempt_3" as FunnelStage,
      assigned_to: "a1",
    }));
    const metrics = computeAgentMetrics(agents, open, []);
    const alice = metrics.find((m) => m.agent_id === "a1")!;
    expect(alice.stuck_order_ids).toHaveLength(10);
  });

  it("computes ttfc_p50 and ttfc_p90 from history", () => {
    // 10 orders, confirmed at 10,20,...,100 minutes after assigned
    const history: HistoryRow[] = [];
    for (let i = 1; i <= 10; i++) {
      const orderId = `o${i}`;
      history.push({
        order_id: orderId,
        status_from: null,
        status_to: "assigned",
        actor_id: "a1",
        created_at: iso(0),
      });
      history.push({
        order_id: orderId,
        status_from: "assigned",
        status_to: "attempt_1",
        actor_id: "a1",
        created_at: iso(i * 10),
      });
      history.push({
        order_id: orderId,
        status_from: "attempt_1",
        status_to: "confirmed",
        actor_id: "a1",
        created_at: iso(i * 10 + 5),
      });
    }
    const metrics = computeAgentMetrics(agents, [], [], history);
    const alice = metrics.find((m) => m.agent_id === "a1")!;
    // TTFC: minutes from assigned to first attempt_1
    // values: 10,20,...,100 → p50≈55, p90≈91
    expect(alice.ttfc_p50_minutes).not.toBeNull();
    expect(alice.ttfc_p90_minutes).not.toBeNull();
    expect(alice.ttfc_samples.length).toBeGreaterThan(0);
  });

  it("returns null ttfc when fewer than 5 samples", () => {
    const history: HistoryRow[] = [
      { order_id: "o1", status_from: null, status_to: "assigned", actor_id: "a1", created_at: iso(0) },
      { order_id: "o1", status_from: "assigned", status_to: "attempt_1", actor_id: "a1", created_at: iso(10) },
    ];
    const metrics = computeAgentMetrics(agents, [], [], history);
    const alice = metrics.find((m) => m.agent_id === "a1")!;
    expect(alice.ttfc_p50_minutes).toBeNull();
    expect(alice.ttfc_p90_minutes).toBeNull();
  });
});

// ─── computeTtfcDistribution ────────────────────────────────────────────────

describe("computeTtfcDistribution", () => {
  it("returns zero counts for empty samples", () => {
    const dist = computeTtfcDistribution([]);
    expect(dist.bucket_minutes).toEqual(TTFC_BUCKETS);
    expect(dist.counts_total.every((c) => c === 0)).toBe(true);
  });

  it("buckets samples correctly", () => {
    // 3 samples in bucket 0–5m, 1 in 5–15m
    const samples = [
      { agent_id: "a1", ttfc: 2 },
      { agent_id: "a1", ttfc: 3 },
      { agent_id: "a2", ttfc: 4 },
      { agent_id: "a2", ttfc: 10 },
    ];
    const dist = computeTtfcDistribution(samples);
    // bucket 0: [0,5) → 3 samples (2, 3, 4)
    expect(dist.counts_total[0]).toBe(3);
    // bucket 1: [5,15) → 1 sample (10)
    expect(dist.counts_total[1]).toBe(1);
    expect(dist.counts_by_agent["a1"][0]).toBe(2);
    expect(dist.counts_by_agent["a2"][0]).toBe(1);
  });
});
