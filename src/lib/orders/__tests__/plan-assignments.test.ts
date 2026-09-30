import { describe, test, expect } from "vitest";
import { planAssignments } from "../auto-assignment";
import type {
  AssignableOrder,
  AssignmentContext,
  AvailableAgent,
  RoundRobinConfig,
} from "../auto-assignment-types";

const NOW = new Date("2026-09-19T12:00:00Z");

function makeAgent(over: Partial<AvailableAgent> & { id: string }): AvailableAgent {
  return {
    queue_size: 0,
    last_action_at: null,
    assigned_today: 0,
    is_available: true,
    is_active: true,
    deleted_at: null,
    last_seen_at: "2026-09-19T11:59:00Z",
    ...over,
  };
}

function makeOrders(n: number): AssignableOrder[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `o-${i}`,
    market_id: "market-tn",
    product_id: null,
    customer_city: null,
  }));
}

function tally(assignments: Array<{ agent_id: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of assignments) out[a.agent_id] = (out[a.agent_id] ?? 0) + 1;
  return out;
}

describe("a batch spreads the way a stream would", () => {
  test("percentage splits a drained pool by the configured shares", () => {
    // THE TRAP the old bulk route fell into: it fed the next iteration by
    // bumping queue_size only. A deficit selector reads assigned_today, which
    // never moved, so every order in the batch went to one agent.
    const agents = [makeAgent({ id: "ahmed" }), makeAgent({ id: "sara" })];
    const ctx: AssignmentContext = { shares: { ahmed: 60, sara: 40 }, totalAssignedToday: 0 };
    const result = planAssignments(makeOrders(10), agents, "percentage", null, ctx, NOW);
    expect(tally(result.assignments)).toEqual({ ahmed: 6, sara: 4 });
  });

  test("round_robin rotates across the batch instead of repeating one agent", () => {
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" }), makeAgent({ id: "c" })];
    const result = planAssignments(makeOrders(6), agents, "round_robin", null, undefined, NOW);
    expect(result.assignments.map((x) => x.agent_id)).toEqual(["a", "b", "c", "a", "b", "c"]);
  });

  test("workload levels the QUEUES, which is not an even share of the batch", () => {
    // Starting queues are 0 and 1. Four more orders make five in total, so the
    // balanced end state is 3 and 2 - meaning `a` takes three of the four and
    // `b` takes one. An even 2/2 split would leave b permanently ahead.
    const agents = [makeAgent({ id: "a", queue_size: 0 }), makeAgent({ id: "b", queue_size: 1 })];
    const result = planAssignments(makeOrders(4), agents, "workload", null, undefined, NOW);
    expect(tally(result.assignments)).toEqual({ a: 3, b: 1 });
  });
});

describe("the cursor survives the batch", () => {
  test("round_robin returns the final index, not the first", () => {
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" }), makeAgent({ id: "c" })];
    const config: RoundRobinConfig = { last_assigned_index: 0 };
    const result = planAssignments(makeOrders(4), agents, "round_robin", config, undefined, NOW);
    expect(result.updated_config).toEqual({ last_assigned_index: 1 });
  });

  test("a stateless algorithm leaves the stored config ALONE", () => {
    // THE OTHER TRAP: the bulk route assigned `runningConfig = decision.updated_config`
    // unconditionally. A stateless selector returns null, so one workload bulk
    // run wrote null over assignment_rules.config and destroyed whatever
    // round_robin / product_rules / region_rules cursor was stored there.
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" })];
    const stored: RoundRobinConfig = { last_assigned_index: 7 };
    const result = planAssignments(makeOrders(5), agents, "workload", stored, undefined, NOW);
    expect(result.updated_config).toEqual({ last_assigned_index: 7 });
  });

  test("percentage likewise never nulls the stored config", () => {
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" })];
    const stored: RoundRobinConfig = { last_assigned_index: 3 };
    const ctx: AssignmentContext = { shares: { a: 50, b: 50 }, totalAssignedToday: 0 };
    const result = planAssignments(makeOrders(4), agents, "percentage", stored, ctx, NOW);
    expect(result.updated_config).toEqual({ last_assigned_index: 3 });
  });
});

describe("what cannot be placed is surfaced, never dropped", () => {
  test("orders left over when nobody is ready are returned as leftover", () => {
    const agents = [makeAgent({ id: "a", is_available: false })];
    const ctx: AssignmentContext = { shares: { a: 100 }, totalAssignedToday: 0 };
    const result = planAssignments(makeOrders(3), agents, "percentage", null, ctx, NOW);
    expect(result.assignments).toEqual([]);
    expect(result.leftover).toEqual(["o-0", "o-1", "o-2"]);
  });

  test("an empty pool is a no-op, not an error", () => {
    const agents = [makeAgent({ id: "a" })];
    const ctx: AssignmentContext = { shares: { a: 100 }, totalAssignedToday: 0 };
    const result = planAssignments([], agents, "percentage", null, ctx, NOW);
    expect(result.assignments).toEqual([]);
    expect(result.leftover).toEqual([]);
  });

  test("manual places nothing and surfaces everything", () => {
    const agents = [makeAgent({ id: "a" })];
    const result = planAssignments(makeOrders(2), agents, "manual", null, undefined, NOW);
    expect(result.assignments).toEqual([]);
    expect(result.leftover).toHaveLength(2);
  });
});

describe("planning is a pure preview", () => {
  test("the caller's agents are not mutated, so preview and write agree", () => {
    // /api/prospects/distribute runs the same planner for ?preview=1 and for
    // the write. If planning mutated its input the two would disagree.
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" })];
    const ctx: AssignmentContext = { shares: { a: 50, b: 50 }, totalAssignedToday: 0 };
    planAssignments(makeOrders(6), agents, "percentage", null, ctx, NOW);
    expect(agents.every((x) => x.assigned_today === 0 && x.queue_size === 0)).toBe(true);
  });

  test("running twice over the same input gives the same plan", () => {
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" }), makeAgent({ id: "c" })];
    const ctx: AssignmentContext = { shares: { a: 50, b: 30, c: 20 }, totalAssignedToday: 0 };
    const first = planAssignments(makeOrders(10), agents, "percentage", null, ctx, NOW);
    const second = planAssignments(makeOrders(10), agents, "percentage", null, ctx, NOW);
    expect(first.assignments).toEqual(second.assignments);
  });
});
