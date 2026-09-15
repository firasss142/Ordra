import { describe, expect, test } from "vitest";
import {
  funnelWidths,
  conversionRate,
  trend,
  agentLoad,
  type CampaignResult,
  type AgentLoad,
} from "../console";

describe("funnelWidths", () => {
  // The prototype draws three segments across one bar: the audience not yet
  // called, those called but not converted, and the conversions.
  test("the three segments together fill the bar exactly", () => {
    const w = funnelWidths({ audience: 400, called: 200, converted: 40 } as CampaignResult);
    expect(w.uncalled + w.called + w.converted).toBeCloseTo(100, 6);
  });

  test("segments are proportional to the audience", () => {
    const w = funnelWidths({ audience: 100, called: 40, converted: 10 } as CampaignResult);
    // 60 never called, 30 called but not converted, 10 converted.
    expect(w).toEqual({ uncalled: 60, called: 30, converted: 10 });
  });

  test("an untouched campaign is all one segment, not an empty bar", () => {
    const w = funnelWidths({ audience: 290, called: 0, converted: 0 } as CampaignResult);
    expect(w).toEqual({ uncalled: 100, called: 0, converted: 0 });
  });

  // A campaign with no audience must not divide by zero and paint NaN widths.
  test("a campaign with no audience yet draws an empty bar rather than NaN", () => {
    const w = funnelWidths({ audience: 0, called: 0, converted: 0 } as CampaignResult);
    expect(w).toEqual({ uncalled: 0, called: 0, converted: 0 });
  });

  // Production has campaigns where `called` exceeds what the audience query
  // returns today, because leads were reassigned out of the campaign.
  test("a called count above the audience never pushes a segment negative", () => {
    const w = funnelWidths({ audience: 10, called: 25, converted: 4 } as CampaignResult);
    expect(w.uncalled).toBe(0);
    expect(w.called).toBeGreaterThanOrEqual(0);
    expect(w.converted).toBeGreaterThanOrEqual(0);
    expect(w.uncalled + w.called + w.converted).toBeLessThanOrEqual(100.000001);
  });
});

describe("conversionRate", () => {
  test("is the share of those called who converted, not of the whole audience", () => {
    // Judging an agent on people nobody rang is judging the distribution.
    expect(conversionRate({ audience: 1000, called: 100, converted: 25 } as CampaignResult)).toBe(25);
  });

  test("nobody called yet is no rate at all, rather than zero per cent", () => {
    expect(conversionRate({ audience: 500, called: 0, converted: 0 } as CampaignResult)).toBeNull();
  });
});

describe("trend", () => {
  test("reports the change against the previous period", () => {
    expect(trend(56, 50)).toEqual({ pct: 12, direction: "up" });
  });

  test("a fall is reported as a fall", () => {
    expect(trend(40, 50)).toEqual({ pct: -20, direction: "down" });
  });

  test("no previous period means no comparison, not a 100 % rise", () => {
    expect(trend(38, 0)).toBeNull();
  });

  test("an unchanged figure is flat, so the arrow does not flicker", () => {
    expect(trend(50, 50)).toEqual({ pct: 0, direction: "flat" });
  });
});

describe("agentLoad", () => {
  const agents: AgentLoad[] = [
    { id: "a", name: "Hend", open_leads: 12, hot_waiting: 2, calls_today: 14, converted_today: 4 },
    { id: "b", name: "Mouna", open_leads: 40, hot_waiting: 0, calls_today: 3, converted_today: 0 },
    { id: "c", name: "Salima", open_leads: 0, hot_waiting: 1, calls_today: 0, converted_today: 0 },
  ];

  test("an agent's rate is conversions over calls made", () => {
    expect(agentLoad(agents)[0].rate).toBe(29);
  });

  test("an agent who has not called today has no rate, rather than a damning zero", () => {
    const salima = agentLoad(agents).find((a) => a.id === "c")!;
    expect(salima.rate).toBeNull();
  });

  // The manager's question is "who needs help", so the worst-served agent is
  // first: hot prospects waiting outrank a merely long queue.
  test("agents with hot prospects waiting come first", () => {
    expect(agentLoad(agents).map((a) => a.id)).toEqual(["a", "c", "b"]);
  });

  test("among agents with no hot prospects, the longest queue comes first", () => {
    const quiet: AgentLoad[] = [
      { id: "x", name: "X", open_leads: 5, hot_waiting: 0, calls_today: 1, converted_today: 0 },
      { id: "y", name: "Y", open_leads: 30, hot_waiting: 0, calls_today: 1, converted_today: 0 },
    ];
    expect(agentLoad(quiet).map((a) => a.id)).toEqual(["y", "x"]);
  });

  test("it does not mutate the array it was given", () => {
    const before = agents.map((a) => a.id);
    agentLoad(agents);
    expect(agents.map((a) => a.id)).toEqual(before);
  });
});
