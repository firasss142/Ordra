import { describe, it, expect } from "vitest";
import { computeInsights, type InsightLabels } from "./insights";
import type { DashboardSummary, TrendPoint, PresenceAgent, TopProductStat } from "./summary";

const labels: InsightLabels = {
  confAboveAvg: "Conf +{diff} pp above avg",
  confBelowAvg: "Conf -{diff} pp below avg",
  topProduct: "Top product: {name} ({count} delivered)",
  leadingAgent: "Leader: {name} ({rate}%)",
};

function makeTrend(rates: number[]): TrendPoint[] {
  return rates.map((r, i) => ({
    day: `2026-04-${String(i + 1).padStart(2, "0")}`,
    confRate: r,
    rejRate: 0,
    revenue: null,
  }));
}

function makeAgent(overrides: Partial<PresenceAgent> = {}): PresenceAgent {
  return {
    agent_id: "a1",
    full_name: "Sara",
    avatar_url: null,
    market_id: "m1",
    state: "online",
    queue_size: 0,
    confirmed_today: 10,
    actioned_today: 10,
    confirmation_rate: 90,
    last_seen_at: null,
    ...overrides,
  };
}

function makeProduct(overrides: Partial<TopProductStat> = {}): TopProductStat {
  return {
    product_id: "prod1",
    product_name: "iPhone 14",
    delivered_count: 48,
    revenue: 24000,
    ...overrides,
  };
}

function makeSummary(overrides: Partial<DashboardSummary> = {}): DashboardSummary {
  return {
    period: { from_date: "2026-04-24", to_date: "2026-04-24" },
    kpis: {
      revenue: null,
      netProfit: null,
      confirmationRate: { current: 90, previous: 85, delta: 5, deltaPct: 5.9 },
      rejectionRate: { current: 10, previous: 15, delta: -5, deltaPct: -33.3 },
      ordersProcessed: { current: 100, previous: 80, delta: 20, deltaPct: 25 },
      deliveryRate: { current: 80, previous: 75, delta: 5, deltaPct: 6.7 },
      agentsOnline: 3,
      agentsTotal: 5,
      agentsIdle: 1,
    },
    trend: makeTrend([85, 86, 87, 88, 89, 90, 87]),
    pipeline: [],
    rejectionBreakdown: [],
    presence: [],
    markets: [],
    topProducts: [],
    footer: { followUpsOpen: 0, campaignsActive: 0, adSpend: null },
    selectedMarket: null,
    availableMarkets: [],
    scope: "single",
    ...overrides,
  };
}

describe("computeInsights — confirmation vs 7-day avg", () => {
  it("emits positive insight when current rate is 1pp+ above 7-day avg", () => {
    // avg of last 7 = (85+86+87+88+89+90+87)/7 ≈ 87.4, current = 90 → diff 2.6
    const summary = makeSummary({ trend: makeTrend([85, 86, 87, 88, 89, 90, 87]) });
    const insights = computeInsights(summary, labels);
    const insight = insights.find((i) => i.key === "conf_vs_avg");
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe("positive");
    expect(insight!.text).toContain("+");
  });

  it("emits negative insight when current rate is 1pp+ below 7-day avg", () => {
    // avg of last 7 = 90, current = 80
    const summary = makeSummary({
      trend: makeTrend([90, 90, 90, 90, 90, 90, 90]),
      kpis: {
        ...makeSummary().kpis,
        confirmationRate: { current: 80, previous: 80, delta: 0, deltaPct: 0 },
      },
    });
    const insights = computeInsights(summary, labels);
    const insight = insights.find((i) => i.key === "conf_vs_avg");
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe("negative");
  });

  it("skips insight when diff < 1pp", () => {
    // avg ≈ 90, current = 90.5 — diff < 1pp
    const summary = makeSummary({
      trend: makeTrend([90, 90, 90, 90, 90, 90, 90]),
      kpis: {
        ...makeSummary().kpis,
        confirmationRate: { current: 90.5, previous: 90, delta: 0.5, deltaPct: 0.6 },
      },
    });
    const insights = computeInsights(summary, labels);
    expect(insights.find((i) => i.key === "conf_vs_avg")).toBeUndefined();
  });

  it("skips when trend has fewer than 7 points", () => {
    const summary = makeSummary({ trend: makeTrend([85, 86, 87, 88, 89]) });
    const insights = computeInsights(summary, labels);
    expect(insights.find((i) => i.key === "conf_vs_avg")).toBeUndefined();
  });
});

describe("computeInsights — top product", () => {
  it("emits top product insight when topProducts is non-empty", () => {
    const summary = makeSummary({ topProducts: [makeProduct()] });
    const insights = computeInsights(summary, labels);
    const insight = insights.find((i) => i.key === "top_product");
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe("neutral");
    expect(insight!.text).toContain("iPhone 14");
    expect(insight!.text).toContain("48");
  });

  it("skips when topProducts is empty", () => {
    const summary = makeSummary({ topProducts: [] });
    const insights = computeInsights(summary, labels);
    expect(insights.find((i) => i.key === "top_product")).toBeUndefined();
  });
});

describe("computeInsights — leading agent", () => {
  it("emits leading agent insight for agent with actioned_today >= 5", () => {
    const summary = makeSummary({
      presence: [makeAgent({ full_name: "Sara", confirmation_rate: 92, actioned_today: 10 })],
    });
    const insights = computeInsights(summary, labels);
    const insight = insights.find((i) => i.key === "leading_agent");
    expect(insight).toBeDefined();
    expect(insight!.tone).toBe("positive");
    expect(insight!.text).toContain("Sara");
  });

  it("skips when no agent has actioned_today >= 5", () => {
    const summary = makeSummary({
      presence: [makeAgent({ actioned_today: 3 })],
    });
    const insights = computeInsights(summary, labels);
    expect(insights.find((i) => i.key === "leading_agent")).toBeUndefined();
  });

  it("picks the agent with highest confirmation_rate", () => {
    const summary = makeSummary({
      presence: [
        makeAgent({ agent_id: "a1", full_name: "Ahmed", confirmation_rate: 80, actioned_today: 10 }),
        makeAgent({ agent_id: "a2", full_name: "Sara", confirmation_rate: 92, actioned_today: 10 }),
      ],
    });
    const insight = computeInsights(summary, labels).find((i) => i.key === "leading_agent");
    expect(insight!.text).toContain("Sara");
  });

  it("tiebreaks by confirmed_today desc", () => {
    const summary = makeSummary({
      presence: [
        makeAgent({ agent_id: "a1", full_name: "Ahmed", confirmation_rate: 90, confirmed_today: 20, actioned_today: 22 }),
        makeAgent({ agent_id: "a2", full_name: "Sara", confirmation_rate: 90, confirmed_today: 30, actioned_today: 33 }),
      ],
    });
    const insight = computeInsights(summary, labels).find((i) => i.key === "leading_agent");
    expect(insight!.text).toContain("Sara");
  });
});

describe("computeInsights — general", () => {
  it("returns at most 3 insights", () => {
    const summary = makeSummary({
      trend: makeTrend([85, 86, 87, 88, 89, 90, 87]),
      topProducts: [makeProduct()],
      presence: [makeAgent()],
    });
    const insights = computeInsights(summary, labels);
    expect(insights.length).toBeLessThanOrEqual(3);
  });

  it("returns insights in order: conf_vs_avg, top_product, leading_agent", () => {
    const summary = makeSummary({
      trend: makeTrend([85, 86, 87, 88, 89, 90, 87]),
      topProducts: [makeProduct()],
      presence: [makeAgent()],
    });
    const keys = computeInsights(summary, labels).map((i) => i.key);
    const confIdx = keys.indexOf("conf_vs_avg");
    const prodIdx = keys.indexOf("top_product");
    const agentIdx = keys.indexOf("leading_agent");
    if (confIdx !== -1 && prodIdx !== -1) expect(confIdx).toBeLessThan(prodIdx);
    if (prodIdx !== -1 && agentIdx !== -1) expect(prodIdx).toBeLessThan(agentIdx);
  });
});
