import { describe, test, expect } from "vitest";
import {
  buildCommissionView,
  balanceAfterPayout,
  payoutCrossesZero,
  fmtCommission,
} from "./view-models";
import type { CommissionAgent, TeamCommissions } from "./types";

const LRI = "⁦";
const PDI = "⁩";

function agent(over: Partial<CommissionAgent>): CommissionAgent {
  return {
    agent_id: over.agent_id ?? "a",
    name: over.name ?? "a",
    avatar_url: null,
    is_active: true,
    rate: over.rate ?? { amount: 3, enabled: true, is_override: false, effective_from: "2026-07-27" },
    delivered: over.delivered ?? 0,
    earned: over.earned ?? 0,
    paid: over.paid ?? 0,
    pending_count: 0,
    pending_est: 0,
    balance: over.balance ?? 0,
    earned_total: over.earned_total ?? 0,
    paid_total: over.paid_total ?? 0,
    last_payout: over.last_payout ?? null,
    ...over,
  };
}

function tc(agents: CommissionAgent[]): TeamCommissions {
  return {
    market_id: "m",
    currency: "LYD",
    from: "2026-08-10",
    to: "2026-08-16",
    tz: "Africa/Tripoli",
    market: { enabled: true, amount: 3, effective_from: "2026-07-27" },
    agents,
    team: {
      delivered: agents.reduce((s, a) => s + a.delivered, 0),
      earned: agents.reduce((s, a) => s + a.earned, 0),
      paid: agents.reduce((s, a) => s + a.paid, 0),
      balance: agents.reduce((s, a) => s + a.balance, 0),
    },
  };
}

describe("buildCommissionView", () => {
  test("to_pay sums only positive balances; negative_count counts debts", () => {
    const v = buildCommissionView(
      tc([
        agent({ agent_id: "t", name: "tasnim", balance: 29500 }),
        agent({ agent_id: "r", name: "roqaya", balance: -7000 }),
        agent({ agent_id: "h", name: "hend", balance: 36000 }),
        agent({ agent_id: "m", name: "mouna", balance: 0 }),
      ]),
    );
    expect(v.totals.to_pay_sum).toBe(65500);
    expect(v.totals.to_pay_count).toBe(2);
    expect(v.totals.negative_count).toBe(1);
    expect(v.totals.balance).toBe(58500);
  });

  test("tone follows the sign of the balance", () => {
    const v = buildCommissionView(
      tc([
        agent({ agent_id: "p", balance: 1 }),
        agent({ agent_id: "n", balance: -1 }),
        agent({ agent_id: "z", balance: 0 }),
      ]),
    );
    expect(v.byId.p.tone).toBe("positive");
    expect(v.byId.n.tone).toBe("negative");
    expect(v.byId.z.tone).toBe("zero");
  });

  test("a disabled agent is flagged, and stays 'to pay' only while a balance remains", () => {
    const off = { amount: 0, enabled: false, is_override: true, effective_from: "2026-08-18" };
    const v = buildCommissionView(
      tc([
        agent({ agent_id: "m", name: "mouna", balance: 0, rate: off }),
        agent({ agent_id: "x", name: "x", balance: 500, rate: off }),
      ]),
    );
    expect(v.byId.m.disabled).toBe(true);
    expect(v.byId.x.disabled).toBe(true);
    expect(v.totals.to_pay_count).toBe(1);
    expect(v.totals.to_pay_sum).toBe(500);
  });

  test("agents are ordered: enabled first, then earned desc, then name", () => {
    const off = { amount: 0, enabled: false, is_override: true, effective_from: "2026-08-18" };
    const v = buildCommissionView(
      tc([
        agent({ agent_id: "m", name: "mouna", earned: 999, rate: off }),
        agent({ agent_id: "s", name: "salima", earned: 27000 }),
        agent({ agent_id: "t", name: "tasnim", earned: 80500 }),
        agent({ agent_id: "b", name: "amal", earned: 27000 }),
      ]),
    );
    expect(v.agents.map((a) => a.agent.agent_id)).toEqual(["t", "b", "s", "m"]);
  });

  test("totals mirror the team block from the RPC", () => {
    const v = buildCommissionView(tc([agent({ agent_id: "t", delivered: 23, earned: 80500, paid: 100000, balance: 29500 })]));
    expect(v.totals.delivered).toBe(23);
    expect(v.totals.earned).toBe(80500);
    expect(v.totals.paid).toBe(100000);
  });
});

describe("buildCommissionView — no rule yet", () => {
  test("flags every agent as unconfigured (not explicitly disabled) when the market has no rule", () => {
    const base = tc([agent({ agent_id: "a", balance: 0 })]);
    const v = buildCommissionView({ ...base, market: null });
    expect(v.byId.a.unconfigured).toBe(true);
    expect(v.byId.a.disabled).toBe(true);
    expect(buildCommissionView(base).byId.a.unconfigured).toBe(false);
  });
});

describe("payout arithmetic", () => {
  test("balanceAfterPayout subtracts", () => {
    expect(balanceAfterPayout(29500, 29500)).toBe(0);
    expect(balanceAfterPayout(29500, 30000)).toBe(-500);
  });
  test("payoutCrossesZero is true only when the payment exceeds what is owed", () => {
    expect(payoutCrossesZero(29500, 29500)).toBe(false);
    expect(payoutCrossesZero(29500, 29500.001)).toBe(true);
    expect(payoutCrossesZero(-7000, 1)).toBe(true);
    expect(payoutCrossesZero(0, 0)).toBe(false);
  });
});

describe("fmtCommission", () => {
  test("whole amounts drop the millimes; fractional keep 3", () => {
    const whole = fmtCommission(3500, "LY");
    expect(whole.startsWith(LRI)).toBe(true);
    expect(whole.endsWith(PDI)).toBe(true);
    expect(whole).not.toContain(",");
    expect(whole).toContain("3");
    expect(fmtCommission(3.5, "LY")).toContain("3,500");
  });
  test("signed adds + on positive, − on negative, nothing on zero", () => {
    expect(fmtCommission(1000, "TN", { signed: true })).toContain("+");
    expect(fmtCommission(-1000, "TN", { signed: true })).toContain("−");
    expect(fmtCommission(0, "TN", { signed: true })).not.toContain("+");
  });
});
