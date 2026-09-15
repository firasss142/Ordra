import { describe, expect, test } from "vitest";
import { planDistribution, type DistributionAgent, type DistributionRule } from "../distribution";

/**
 * The manager's primary job on this page. Measured in production on
 * 2026-09-15: 1 984 of 1 992 prospects have no agent at all, so nobody sees
 * them and nobody calls them.
 */

const agent = (over: Partial<DistributionAgent> & { id: string }): DistributionAgent => ({
  name: over.id,
  queue: 0,
  callsToday: 0,
  ...over,
});

/** Six active agents in Libya, four in Tunisia — the real rosters. */
const THREE = [agent({ id: "hend" }), agent({ id: "mouna" }), agent({ id: "roqaya" })];

const plan = (
  over: Partial<Parameters<typeof planDistribution>[0]> = {},
) =>
  planDistribution({
    leads: [],
    agents: THREE,
    rule: "history_then_round_robin",
    cap: 20,
    ...over,
  });

/** N leads with no prior agent, the Tunisian case. */
const anonymous = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `l${i}`, lastAgentId: null }));

describe("the daily cap is a promise to the agent, not a suggestion", () => {
  test("nobody is given more than the cap, however big the pool", () => {
    const { rows } = plan({ leads: anonymous(1000), cap: 20 });
    for (const r of rows) expect(r.total).toBeLessThanOrEqual(20);
  });

  test("calls already made today count against the cap", () => {
    // An agent who has made 15 of their 20 calls can take 5 more, not 20.
    const { rows } = plan({
      leads: anonymous(100),
      agents: [agent({ id: "hend", callsToday: 15 })],
      cap: 20,
    });
    expect(rows[0].total).toBe(5);
  });

  test("an agent already at their cap is given nothing rather than a negative share", () => {
    const { rows } = plan({
      leads: anonymous(100),
      agents: [agent({ id: "hend", callsToday: 40 })],
      cap: 20,
    });
    expect(rows[0].total).toBe(0);
  });

  test("what the caps cannot absorb waits instead of vanishing", () => {
    // Three agents × 20 = 60 today; the rest is tomorrow's work, and the
    // manager must be told so rather than silently losing 1 640 prospects.
    const { assigned, left } = plan({ leads: anonymous(1700), cap: 20 });
    expect(assigned).toBe(60);
    expect(left).toBe(1640);
  });

  test("every lead is either assigned or counted as waiting", () => {
    const { rows, left } = plan({ leads: anonymous(1700), cap: 20 });
    const total = rows.reduce((s, r) => s + r.total, 0);
    expect(total + left).toBe(1700);
  });
});

describe("decision 33: the customer hears the voice they already know", () => {
  test("a lead goes back to the agent who last confirmed that customer", () => {
    const { rows } = plan({
      leads: [
        { id: "a", lastAgentId: "mouna" },
        { id: "b", lastAgentId: "mouna" },
        { id: "c", lastAgentId: "roqaya" },
      ],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.agentId, r]));
    expect(byId.mouna.byHistory).toBe(2);
    expect(byId.roqaya.byHistory).toBe(1);
    expect(byId.hend.byHistory).toBe(0);
  });

  test("a prior agent who has left is not counted as history", () => {
    // 21 of Tunisia's 93 matched leads point at a deactivated agent. Their
    // leads must be redistributed, not assigned to someone who cannot call.
    const { rows, assigned } = plan({
      leads: [{ id: "a", lastAgentId: "rihab-who-left" }],
    });
    expect(rows.every((r) => r.byHistory === 0)).toBe(true);
    expect(assigned).toBe(1);
  });

  test("history still respects the cap, spilling the excess to round robin", () => {
    // One agent cannot take 30 of their own customers when the cap is 20.
    const leads = Array.from({ length: 30 }, (_, i) => ({ id: `l${i}`, lastAgentId: "hend" }));
    const { rows, assigned } = plan({ leads, cap: 20 });
    const byId = Object.fromEntries(rows.map((r) => [r.agentId, r]));
    expect(byId.hend.byHistory).toBe(20);
    expect(byId.hend.total).toBe(20);
    // The other 10 go to the two remaining agents, as round robin.
    expect(assigned).toBe(30);
    expect(byId.mouna.byRoundRobin + byId.roqaya.byRoundRobin).toBe(10);
  });

  test("the split between history and round robin is reported, never merged", () => {
    // Libya: 288 of 288 have a prior agent. Tunisia: 93 of 1 685. A manager
    // in Tunis must see that 96 % of the batch is round robin before they
    // confirm, or they expect a continuity they will not get.
    const leads = [
      { id: "a", lastAgentId: "hend" },
      ...anonymous(9),
    ];
    const { rows } = plan({ leads });
    const history = rows.reduce((s, r) => s + r.byHistory, 0);
    const robin = rows.reduce((s, r) => s + r.byRoundRobin, 0);
    expect(history).toBe(1);
    expect(robin).toBe(9);
    for (const r of rows) expect(r.byHistory + r.byRoundRobin).toBe(r.total);
  });
});

describe("strict round robin ignores history on purpose", () => {
  const rule: DistributionRule = "round_robin";

  test("a known customer is not routed to their old agent", () => {
    const { rows } = plan({ leads: [{ id: "a", lastAgentId: "mouna" }], rule });
    expect(rows.every((r) => r.byHistory === 0)).toBe(true);
  });

  test("shares are as equal as whole prospects allow", () => {
    const { rows } = plan({ leads: anonymous(9), rule });
    expect(rows.map((r) => r.total).sort()).toEqual([3, 3, 3]);
  });

  test("a remainder that will not divide is spread, not dropped", () => {
    const { rows, assigned } = plan({ leads: anonymous(10), rule });
    expect(assigned).toBe(10);
    // 4/3/3 in some order — never 3/3/3 with one lost.
    expect(rows.map((r) => r.total).sort()).toEqual([3, 3, 4]);
  });
});

describe("by current queue, the busiest agent is spared", () => {
  const rule: DistributionRule = "by_queue";

  test("the agent with the lightest queue receives the most", () => {
    const { rows } = plan({
      leads: anonymous(30),
      agents: [
        agent({ id: "busy", queue: 30 }),
        agent({ id: "quiet", queue: 0 }),
      ],
      rule,
      cap: 20,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.agentId, r]));
    expect(byId.quiet.total).toBeGreaterThan(byId.busy.total);
  });

  test("an agent already drowning is given nothing rather than a token share", () => {
    const { rows } = plan({
      leads: anonymous(20),
      agents: [agent({ id: "drowning", queue: 500 }), agent({ id: "quiet", queue: 0 })],
      rule,
    });
    const byId = Object.fromEntries(rows.map((r) => [r.agentId, r]));
    expect(byId.drowning.total).toBe(0);
    expect(byId.quiet.total).toBe(20);
  });

  test("equal queues fall back to equal shares", () => {
    const { rows } = plan({ leads: anonymous(9), rule });
    expect(rows.map((r) => r.total).sort()).toEqual([3, 3, 3]);
  });
});

describe("the sheet must not be able to promise something impossible", () => {
  test("no agents chosen means nothing is assigned and everything waits", () => {
    const { rows, assigned, left } = plan({ leads: anonymous(100), agents: [] });
    expect(rows).toEqual([]);
    expect(assigned).toBe(0);
    expect(left).toBe(100);
  });

  test("an empty pool produces an empty plan, not a division by zero", () => {
    const { rows, assigned, left } = plan({ leads: [] });
    expect(assigned).toBe(0);
    expect(left).toBe(0);
    for (const r of rows) expect(r.total).toBe(0);
  });

  test("a cap of zero assigns nothing", () => {
    const { assigned, left } = plan({ leads: anonymous(50), cap: 0 });
    expect(assigned).toBe(0);
    expect(left).toBe(50);
  });

  test("the queue after distribution is what the agent will actually face", () => {
    const { rows } = plan({
      leads: anonymous(10),
      agents: [agent({ id: "hend", queue: 12 })],
      cap: 20,
    });
    expect(rows[0].total).toBe(10);
    expect(rows[0].queueAfter).toBe(22);
  });

  test("every chosen agent appears in the plan, even when given nothing", () => {
    // The preview table lists the agents the manager ticked; one receiving
    // zero must show as zero rather than disappearing from the table.
    const { rows } = plan({
      leads: anonymous(1),
      agents: [agent({ id: "hend", callsToday: 20 }), agent({ id: "mouna" })],
      cap: 20,
    });
    expect(rows.map((r) => r.agentId).sort()).toEqual(["hend", "mouna"]);
  });

  test("the plan is deterministic, so the preview matches what is written", () => {
    // The preview and the confirmed write are two separate calls; if they
    // disagreed, the manager would be shown numbers that never happened.
    const once = plan({ leads: anonymous(17) });
    const twice = plan({ leads: anonymous(17) });
    expect(once).toEqual(twice);
  });
});
