import { describe, test, expect } from "vitest";
import { summariseReadiness } from "../readiness-summary";
import type { AgentCapacityRow } from "@/hooks/useAgentCapacity";

function agent(over: Partial<AgentCapacityRow> & { id: string }): AgentCapacityRow {
  return {
    full_name: over.id,
    avatar_url: null,
    is_active: true,
    last_seen_at: new Date().toISOString(),
    last_action_at: null,
    queue_size: 0,
    confirmation_rate: 0,
    actioned_count: 0,
    is_available: true,
    available_since: null,
    assigned_today: 0,
    share_pct: null,
    receiving_orders: true,
    ...over,
  };
}

describe("the three states a manager has to tell apart", () => {
  test("declared and beating is ready", () => {
    const s = summariseReadiness([agent({ id: "a" })]);
    expect(s.rows[0].ready).toBe(true);
    expect(s.rows[0].stale).toBe(false);
    expect(s.readyCount).toBe(1);
  });

  test("declared but not beating is STALE, not simply unavailable", () => {
    // This agent believes they are working and is receiving nothing. Folding
    // it into "paused" would hide the only state that needs a phone call.
    const s = summariseReadiness([
      agent({ id: "a", is_available: true, receiving_orders: false }),
    ]);
    expect(s.rows[0].ready).toBe(false);
    expect(s.rows[0].stale).toBe(true);
    expect(s.staleCount).toBe(1);
  });

  test("paused is neither ready nor stale", () => {
    const s = summariseReadiness([
      agent({ id: "a", is_available: false, receiving_orders: false }),
    ]);
    expect(s.rows[0].ready).toBe(false);
    expect(s.rows[0].stale).toBe(false);
  });
});

describe("nobodyReady is the alarm", () => {
  test("true when every agent is off — new orders will pile up in the pool", () => {
    const s = summariseReadiness([
      agent({ id: "a", is_available: false, receiving_orders: false }),
      agent({ id: "b", is_available: true, receiving_orders: false }),
    ]);
    expect(s.nobodyReady).toBe(true);
  });

  test("false as soon as one agent can take work", () => {
    const s = summariseReadiness([
      agent({ id: "a", receiving_orders: true }),
      agent({ id: "b", is_available: false, receiving_orders: false }),
    ]);
    expect(s.nobodyReady).toBe(false);
  });

  test("false for an empty market — no agents is not an outage", () => {
    expect(summariseReadiness([]).nobodyReady).toBe(false);
  });
});

describe("drift against the configured share", () => {
  test("target is the share of what the market has actually distributed", () => {
    const s = summariseReadiness([
      agent({ id: "ahmed", share_pct: 40, assigned_today: 30 }),
      agent({ id: "sara", share_pct: 60, assigned_today: 70 }),
    ]);
    // 100 distributed: ahmed owed 40 (has 30), sara owed 60 (has 70).
    const ahmed = s.rows.find((r) => r.agent.id === "ahmed")!;
    const sara = s.rows.find((r) => r.agent.id === "sara")!;
    expect(ahmed.target).toBe(40);
    expect(ahmed.drift).toBe(-10);
    expect(sara.target).toBe(60);
    expect(sara.drift).toBe(10);
  });

  test("counts absent agents in the denominator — the quota is strict", () => {
    const s = summariseReadiness([
      agent({ id: "here", share_pct: 50, assigned_today: 20 }),
      agent({ id: "gone", share_pct: 50, assigned_today: 80, is_available: false, receiving_orders: false }),
    ]);
    expect(s.distributedToday).toBe(100);
    expect(s.rows.find((r) => r.agent.id === "here")!.drift).toBe(-30);
  });

  test("no share configured means no target and no verdict", () => {
    const s = summariseReadiness([agent({ id: "a", assigned_today: 12 })]);
    expect(s.rows[0].target).toBeNull();
    expect(s.rows[0].drift).toBeNull();
  });
});

describe("sharesIncomplete catches a split that cannot work", () => {
  test("flags a column that does not total 100", () => {
    const s = summariseReadiness([
      agent({ id: "a", share_pct: 40 }),
      agent({ id: "b", share_pct: 30 }),
    ]);
    expect(s.sharesIncomplete).toBe(true);
  });

  test("silent when the split is whole", () => {
    const s = summariseReadiness([
      agent({ id: "a", share_pct: 40 }),
      agent({ id: "b", share_pct: 60 }),
    ]);
    expect(s.sharesIncomplete).toBe(false);
  });

  test("silent for a market that does not use shares at all", () => {
    const s = summariseReadiness([agent({ id: "a" }), agent({ id: "b" })]);
    expect(s.sharesIncomplete).toBe(false);
  });
});

describe("the order the manager reads", () => {
  test("ready first, then stale, then paused; furthest behind first within each", () => {
    const s = summariseReadiness([
      agent({ id: "paused", is_available: false, receiving_orders: false }),
      agent({ id: "stale", is_available: true, receiving_orders: false }),
      agent({ id: "ready-ahead", share_pct: 50, assigned_today: 80 }),
      agent({ id: "ready-behind", share_pct: 50, assigned_today: 20 }),
    ]);
    expect(s.rows.map((r) => r.agent.id)).toEqual([
      "ready-behind",
      "ready-ahead",
      "stale",
      "paused",
    ]);
  });
});
