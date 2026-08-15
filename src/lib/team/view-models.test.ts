import { describe, it, expect } from "vitest";
import {
  buildPerformanceView,
  buildLiveView,
  localDaysBetween,
  productSpread,
  medianOf,
} from "./view-models";
import type { PerfAgent, TeamPerformance, TeamLive } from "./types";

const agent = (over: Partial<PerfAgent>): PerfAgent => ({
  agent_id: "id",
  name: "x",
  avatar_url: null,
  last_seen_at: null,
  treated: 0,
  confirmed: 0,
  rejected: 0,
  touches: 0,
  active_minutes: 0,
  days_active: 0,
  daily: [],
  products: [],
  motifs: [],
  targets: { daily_treated: null, min_rate: null, conf_per_hour: null, throughput: null },
  ...over,
});

describe("localDaysBetween", () => {
  it("lists ISO days inclusive", () => {
    expect(localDaysBetween("2026-08-08", "2026-08-10")).toEqual(["2026-08-08", "2026-08-09", "2026-08-10"]);
  });
});

describe("medianOf", () => {
  it("handles odd/even/empty", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([1, 2, 3, 4])).toBe(2.5);
    expect(medianOf([])).toBeNull();
  });
});

describe("productSpread", () => {
  it("only agents with ≥ 10 treated qualify for min/max, spread in points", () => {
    const r = productSpread(
      [
        { agent_id: "salima", treated: 19, confirmed: 12 }, // 63.2
        { agent_id: "roqaya", treated: 39, confirmed: 14 }, // 35.9
        { agent_id: "tasnim", treated: 28, confirmed: 16 }, // 57.1
        { agent_id: "riheb", treated: 2, confirmed: 2 }, // excluded
      ],
      { salima: "salima", roqaya: "roqaya", tasnim: "tasnim", riheb: "riheb" },
    );
    expect(r?.max.name).toBe("salima");
    expect(r?.min.name).toBe("roqaya");
    expect(r?.spread).toBeCloseTo(27.3, 1);
  });
  it("returns null with fewer than two qualifying agents", () => {
    expect(productSpread([{ agent_id: "a", treated: 30, confirmed: 10 }], { a: "a" })).toBeNull();
  });
});

describe("buildPerformanceView", () => {
  const perf: TeamPerformance = {
    from: "2026-08-08",
    to: "2026-08-14",
    tz: "Africa/Tripoli",
    market_id: "m",
    defaults: { daily_treated: 12, min_rate: 40, conf_per_hour: 3, team_weekly_conf: 150 },
    team: { treated: 341, confirmed: 129, active_minutes: 2470, agents_active: 5, agents_total: 6 },
    agents: [
      agent({ agent_id: "tasnim", name: "tasnim", treated: 89, confirmed: 40, active_minutes: 860, days_active: 5,
        daily: [
          { day: "2026-08-08", active_minutes: 240, treated: 28, confirmed: 13 },
          { day: "2026-08-10", active_minutes: 90, treated: 8, confirmed: 3 },
          { day: "2026-08-11", active_minutes: 220, treated: 28, confirmed: 13 },
          { day: "2026-08-12", active_minutes: 150, treated: 12, confirmed: 5 },
          { day: "2026-08-14", active_minutes: 160, treated: 13, confirmed: 6 },
        ] }),
      agent({ agent_id: "roqaya", name: "roqaya", treated: 131, confirmed: 35, active_minutes: 520, days_active: 6 }),
      agent({ agent_id: "riheb", name: "riheb", treated: 1, confirmed: 1, active_minutes: 20, days_active: 1 }),
      agent({ agent_id: "mouna", name: "mouna" }),
    ],
    products: [],
  };

  it("ranks on confirmations per active hour and lists the rest as unranked", () => {
    const v = buildPerformanceView(perf);
    expect(v.ranked.map((r) => r.agent.name)).toEqual(["roqaya", "tasnim"]);
    expect(v.ranked[0].confPerHour).toBeCloseTo(4.04, 2);
    expect(v.unranked.map((u) => u.agent.name)).toEqual(["riheb", "mouna"]);
  });

  it("computes weighted team rate, not the mean of agent rates", () => {
    const v = buildPerformanceView(perf);
    expect(v.team.rate).toBeCloseTo(37.8, 1);
  });

  it("derives streaks from the daily series with the market defaults", () => {
    const v = buildPerformanceView(perf);
    const tasnim = v.byId["tasnim"];
    expect(tasnim.streak).toEqual({ current: 3, best: 3 });
  });

  it("masks rates under 10 treated", () => {
    const v = buildPerformanceView(perf);
    expect(v.byId["riheb"].rate).toBeNull();
    expect(v.byId["roqaya"].rate).toBeCloseTo(26.7, 1);
  });

  it("suggests coaching on the weakest component", () => {
    const v = buildPerformanceView(perf);
    expect(v.byId["roqaya"].coaching).toEqual({ metric: "rate", value: 40 });
    expect(v.byId["tasnim"].coaching?.metric).toBe("throughput");
  });

  it("builds heatmap days for the period only", () => {
    const v = buildPerformanceView(perf);
    expect(v.days).toHaveLength(7);
    expect(v.byId["tasnim"].heat[0]).toEqual({ day: "2026-08-08", active_minutes: 240, treated: 28, confirmed: 13 });
    expect(v.byId["tasnim"].heat[1].active_minutes).toBe(0);
  });
});

describe("buildLiveView", () => {
  it("evaluates today's goals per agent with defaults and overrides", () => {
    const live = {
      computed_at: "x", tz: "Africa/Tripoli", market_id: "m",
      defaults: { daily_treated: 12, min_rate: 40 },
      presence: { online: 0, total: 2 },
      tiles: {
        exhausted: { count: 23, oldest_days: 7.9, by_agent: [] },
        orphan_queues: { count: 6, agents_count: 3, confirmed_never_uploaded: 3, by_agent: [] },
        overdue_callbacks: { count: 0, oldest_hours: null },
        never_called: { count: 0, oldest_hours: null },
      },
      blocked_count: 28,
      agents: [
        { agent_id: "t", name: "tasnim", avatar_url: null, last_seen_at: null, presence: "idle", last_action: null,
          today: { touches: 95, treated: 13, confirmed: 6, active_minutes: 160 },
          queue: { total: 28, older_24h: 26, exhausted: 21, confirmed_awaiting: 1, overdue_callbacks: 0, stale_untouched: 0, oldest_days: 9.2, by_product: [] },
          targets: { daily_treated: null, min_rate: null } },
        { agent_id: "s", name: "salima", avatar_url: null, last_seen_at: null, presence: "offline", last_action: null,
          today: { touches: 30, treated: 13, confirmed: 6, active_minutes: 100 },
          queue: { total: 1, older_24h: 0, exhausted: 0, confirmed_awaiting: 0, overdue_callbacks: 0, stale_untouched: 0, oldest_days: 2, by_product: [] },
          targets: { daily_treated: 20, min_rate: null } },
      ],
      blocked: [], callbacks_upcoming: [],
    } as unknown as TeamLive;
    const v = buildLiveView(live);
    expect(v.agents[0].goals.metCount).toBe(3);
    expect(v.agents[1].goals.volume.met).toBe(false); // override 20
    expect(v.verdict).toEqual({ online: 0, total: 2, blocked: 28, orphanAgents: 3 });
  });
});
