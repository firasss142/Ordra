import { describe, test, expect } from "vitest";
import { selectAgent } from "../auto-assignment";
import type {
  AssignableOrder,
  AssignmentContext,
  AvailableAgent,
} from "../auto-assignment-types";

function makeOrder(over: Partial<AssignableOrder> = {}): AssignableOrder {
  return { id: "order-1", market_id: "market-tn", product_id: null, customer_city: null, ...over };
}

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

const NOW = new Date("2026-09-19T12:00:00Z");

/**
 * Hand out `n` orders one at a time, feeding each decision back in exactly as
 * the orchestrator and the drain do. Returns the tally per agent.
 */
function distribute(
  agents: AvailableAgent[],
  shares: Record<string, number>,
  n: number,
): Record<string, number> {
  const pool = agents.map((a) => ({ ...a }));
  let total = pool.reduce((sum, a) => sum + a.assigned_today, 0);

  for (let i = 0; i < n; i++) {
    const ctx: AssignmentContext = { shares, totalAssignedToday: total };
    const decision = selectAgent(makeOrder({ id: `o-${i}` }), pool, "percentage", null, ctx, NOW);
    if (!decision) throw new Error(`no decision at order ${i}`);
    const winner = pool.find((a) => a.id === decision.agent_id)!;
    winner.assigned_today += 1;
    total += 1;
  }

  return Object.fromEntries(pool.map((a) => [a.id, a.assigned_today]));
}

describe("the split a manager typed is the split they get", () => {
  test("40/30/30 over 100 orders lands on 40/30/30", () => {
    const agents = [makeAgent({ id: "ahmed" }), makeAgent({ id: "sara" }), makeAgent({ id: "karim" })];
    const tally = distribute(agents, { ahmed: 40, sara: 30, karim: 30 }, 100);
    expect(tally).toEqual({ ahmed: 40, sara: 30, karim: 30 });
  });

  test("an uneven split still lands within one order of target", () => {
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" }), makeAgent({ id: "c" })];
    const tally = distribute(agents, { a: 55, b: 33, c: 12 }, 100);
    expect(Math.abs(tally.a - 55)).toBeLessThanOrEqual(1);
    expect(Math.abs(tally.b - 33)).toBeLessThanOrEqual(1);
    expect(Math.abs(tally.c - 12)).toBeLessThanOrEqual(1);
  });

  test("a single ready agent takes everything regardless of their share", () => {
    const tally = distribute([makeAgent({ id: "solo" })], { solo: 40, absent: 60 }, 10);
    expect(tally.solo).toBe(10);
  });
});

describe("strict daily quota — an absence is repaid, not forgiven", () => {
  test("the agent furthest behind their target is chosen", () => {
    const agents = [
      makeAgent({ id: "ahmed", assigned_today: 80 }),
      makeAgent({ id: "sara", assigned_today: 60 }),
      makeAgent({ id: "karim", assigned_today: 0 }), // was off all morning
    ];
    const ctx: AssignmentContext = {
      shares: { ahmed: 40, sara: 30, karim: 30 },
      totalAssignedToday: 140,
    };
    const decision = selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW);
    expect(decision!.agent_id).toBe("karim");
  });

  test("catch-up continues until the returning agent is level, then stops", () => {
    const agents = [
      makeAgent({ id: "ahmed", assigned_today: 70 }),
      makeAgent({ id: "karim", assigned_today: 0 }),
    ];
    // 50/50 with ahmed 70 ahead: karim should take the next 70 in a row, and
    // the 71st should go back to ahmed.
    const tally = distribute(agents, { ahmed: 50, karim: 50 }, 70);
    expect(tally).toEqual({ ahmed: 70, karim: 70 });
  });

  test("an absent agent's counts still inflate the denominator", () => {
    // Strict quota, not renormalisation: karim is NOT ready, but the 50 orders
    // he took this morning are part of the day and set everyone's target.
    const agents = [
      makeAgent({ id: "ahmed", assigned_today: 30 }),
      makeAgent({ id: "sara", assigned_today: 30 }),
    ];
    const ctx: AssignmentContext = {
      shares: { ahmed: 40, sara: 30, karim: 30 },
      totalAssignedToday: 110, // 30 + 30 + karim's 50
    };
    // ahmed's target is 0.40 x 111 = 44.4, sara's 0.30 x 111 = 33.3.
    // ahmed is 14.4 behind, sara 3.3 behind.
    const decision = selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW);
    expect(decision!.agent_id).toBe("ahmed");
  });
});

describe("the engine is stateless — that is what stops it drifting", () => {
  test("updated_config is always null", () => {
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" })];
    const ctx: AssignmentContext = { shares: { a: 50, b: 50 }, totalAssignedToday: 0 };
    const decision = selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW);
    expect(decision!.updated_config).toBeNull();
  });
});

describe("who is excluded, and what happens when nobody is left", () => {
  test("a 0% agent never receives an order", () => {
    const tally = distribute(
      [makeAgent({ id: "a" }), makeAgent({ id: "zero" })],
      { a: 100, zero: 0 },
      20,
    );
    expect(tally.zero).toBe(0);
    expect(tally.a).toBe(20);
  });

  test("an agent with no share row at all never receives an order", () => {
    const tally = distribute(
      [makeAgent({ id: "a" }), makeAgent({ id: "unlisted" })],
      { a: 100 },
      12,
    );
    expect(tally.unlisted).toBe(0);
  });

  test("an unready agent is skipped even with the largest deficit", () => {
    const agents = [
      makeAgent({ id: "ready", assigned_today: 50 }),
      makeAgent({ id: "offline", assigned_today: 0, is_available: false }),
    ];
    const ctx: AssignmentContext = { shares: { ready: 50, offline: 50 }, totalAssignedToday: 50 };
    const decision = selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW);
    expect(decision!.agent_id).toBe("ready");
  });

  test("a soft-deleted agent holding a share is skipped", () => {
    const agents = [
      makeAgent({ id: "ready", assigned_today: 50 }),
      makeAgent({ id: "gone", assigned_today: 0, deleted_at: "2026-09-01T00:00:00Z" }),
    ];
    const ctx: AssignmentContext = { shares: { ready: 50, gone: 50 }, totalAssignedToday: 50 };
    const decision = selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW);
    expect(decision!.agent_id).toBe("ready");
  });

  test("nobody ready returns null — the order waits in the pool", () => {
    const agents = [makeAgent({ id: "a", is_available: false })];
    const ctx: AssignmentContext = { shares: { a: 100 }, totalAssignedToday: 0 };
    expect(selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW)).toBeNull();
  });

  test("no shares configured returns null rather than guessing a split", () => {
    const agents = [makeAgent({ id: "a" }), makeAgent({ id: "b" })];
    const ctx: AssignmentContext = { shares: {}, totalAssignedToday: 0 };
    expect(selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW)).toBeNull();
  });

  test("no context at all returns null — percentage never falls back to workload", () => {
    // The other algorithms fall back to selectByWorkload when their rule does
    // not match. Percentage must not: silently spreading by workload would
    // look like the manager's split is being honoured when it is not.
    const agents = [makeAgent({ id: "a" })];
    expect(selectAgent(makeOrder(), agents, "percentage", null)).toBeNull();
  });
});

describe("ties are broken deterministically", () => {
  test("on a fresh day the largest share goes first", () => {
    const agents = [makeAgent({ id: "small" }), makeAgent({ id: "big" })];
    const ctx: AssignmentContext = { shares: { small: 30, big: 70 }, totalAssignedToday: 0 };
    const decision = selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW);
    expect(decision!.agent_id).toBe("big");
  });

  test("equal share and equal deficit falls to the shorter queue", () => {
    const agents = [
      makeAgent({ id: "busy", queue_size: 9 }),
      makeAgent({ id: "free", queue_size: 1 }),
    ];
    const ctx: AssignmentContext = { shares: { busy: 50, free: 50 }, totalAssignedToday: 0 };
    const decision = selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW);
    expect(decision!.agent_id).toBe("free");
  });

  test("everything equal falls to the id, so two replicas agree", () => {
    const agents = [makeAgent({ id: "b" }), makeAgent({ id: "a" })];
    const ctx: AssignmentContext = { shares: { a: 50, b: 50 }, totalAssignedToday: 0 };
    const decision = selectAgent(makeOrder(), agents, "percentage", null, ctx, NOW);
    expect(decision!.agent_id).toBe("a");
  });
});
