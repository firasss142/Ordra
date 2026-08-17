import { describe, it, expect } from "vitest";
import {
  CADENCE_ABANDON_MIN,
  CADENCE_SLA_MIN,
  buildAgentDayView,
  cadenceTier,
} from "./day-view";
import type { AgentDayDetail } from "./types";

/** A day with nothing in it; each test overrides only what it is about. */
function detail(over: Partial<AgentDayDetail> = {}): AgentDayDetail {
  return {
    day: "2026-08-11",
    tz: "Africa/Tripoli",
    market_id: "m1",
    agent: { agent_id: "a1", name: "tasnim", avatar_url: null },
    targets: { daily_treated: 12, min_rate: 40, conf_per_hour: 3, max_attempts: 8 },
    totals: {
      assigned: 0, calls: 0, attempted: 0, touched: 0, treated: 0, confirmed: 0, rejected: 0,
      active_minutes: 0, uploaded: 0, stuck_confirmed: 0, lost_after_confirm: 0,
    },
    hourly: [],
    late_hours: {},
    products: [],
    motifs: [],
    cadence: { judged: 0, late: 0, median_gap_min: null, tiers: { ok: 0, late: 0, abandoned: 0 }, orders: [] },
    queue_end_of_day: { open: 0, uploaded: 0, rejected: 0, by_attempts_left: [] },
    series: [],
    ...over,
  };
}

describe("cadenceTier", () => {
  it("treats the SLA boundary itself as on time", () => {
    expect(cadenceTier(CADENCE_SLA_MIN)).toBe("ok");
    expect(cadenceTier(CADENCE_SLA_MIN + 1)).toBe("late");
  });

  it("separates same-day lateness from multi-day abandonment", () => {
    // The distinction the real data forced: 3h late and 3 days late are
    // different failures and must not collapse into one "late" bucket.
    expect(cadenceTier(200)).toBe("late");
    expect(cadenceTier(CADENCE_ABANDON_MIN)).toBe("late");
    expect(cadenceTier(CADENCE_ABANDON_MIN + 1)).toBe("abandoned");
    expect(cadenceTier(4249)).toBe("abandoned");
  });
});

describe("buildAgentDayView — yield", () => {
  it("rates uploads against treated, not against confirmations", () => {
    // 13 confirmed but only 7 shipped: confirming is not the outcome.
    const v = buildAgentDayView(
      detail({ totals: { ...detail().totals, treated: 28, confirmed: 13, uploaded: 7, active_minutes: 220 } }),
    );
    expect(v.confirmRate).toBeCloseTo(46.4, 1);
    expect(v.uploadRate).toBeCloseTo(25, 1);
  });

  it("reports the shortfall of real yield against the quality target", () => {
    const v = buildAgentDayView(
      detail({ totals: { ...detail().totals, treated: 28, confirmed: 13, uploaded: 11 } }),
    );
    // 11/28 = 39.3 %, target 40 % → −0.7 pt
    expect(v.uploadRate).toBeCloseTo(39.3, 1);
    expect(v.signatureDelta).toBeCloseTo(-0.7, 1);
  });

  it("has no rate at all when nothing was treated", () => {
    const v = buildAgentDayView(detail());
    expect(v.confirmRate).toBeNull();
    expect(v.uploadRate).toBeNull();
    expect(v.uploadsPerHour).toBeNull();
  });

  it("measures upload rhythm per active hour", () => {
    const v = buildAgentDayView(
      detail({ totals: { ...detail().totals, treated: 28, uploaded: 11, active_minutes: 220 } }),
    );
    expect(v.uploadsPerHour).toBeCloseTo(3, 1);
  });
});

describe("buildAgentDayView — the day as a funnel", () => {
  /** 11 Aug in production: 43 assigned, 37 attempted, 62 calls, 13 confirmed of
   *  which 7 shipped, 15 rejected, 28 treated. */
  const REAL_DAY = detail({
    totals: {
      assigned: 43, calls: 62, attempted: 37, touched: 37, treated: 28,
      confirmed: 13, rejected: 15, active_minutes: 220, uploaded: 7,
      stuck_confirmed: 0, lost_after_confirm: 6,
    },
  });

  it("names the orders that sat all day without a single call", () => {
    // The whole point of showing `assigned` next to `attempted`.
    expect(buildAgentDayView(REAL_DAY).funnel.notAttempted).toBe(6);
  });

  it("closes: attempted + never-called accounts for every assigned order", () => {
    const f = buildAgentDayView(REAL_DAY).funnel;
    expect(f.attempted + f.notAttempted).toBe(f.assigned);
  });

  it("closes: the four outcomes account for every attempted order", () => {
    const f = buildAgentDayView(REAL_DAY).funnel;
    expect(f.outcome.reduce((s, o) => s + o.n, 0)).toBe(f.attempted);
    const by = Object.fromEntries(f.outcome.map((o) => [o.kind, o.n]));
    expect(by.uploaded).toBe(7);
    expect(by.stuck).toBe(6); // confirmed 13 − shipped 7
    expect(by.rejected).toBe(15);
    expect(by.pending).toBe(9); // attempted 37 − treated 28
  });

  it("measures how hard the agent had to dial", () => {
    // 62 calls across 37 orders — the effort behind the volume.
    expect(buildAgentDayView(REAL_DAY).funnel.callsPerAttempt).toBeCloseTo(1.7, 1);
    expect(buildAgentDayView(REAL_DAY).funnel.reachRate).toBeCloseTo(86, 0);
  });

  it("never reports a negative gap when the pool is smaller than what was called", () => {
    // Assignment history is reconstructed and can undercount; the bar must not invert.
    const v = buildAgentDayView(
      detail({ totals: { ...detail().totals, assigned: 5, attempted: 9, calls: 12, touched: 9 } }),
    );
    expect(v.funnel.notAttempted).toBe(0);
    expect(v.funnel.assigned).toBe(9);
  });

  it("has no rates on a day with nothing in it", () => {
    const f = buildAgentDayView(detail()).funnel;
    expect(f.reachRate).toBeNull();
    expect(f.callsPerAttempt).toBeNull();
    expect(f.outcome.every((o) => o.n === 0)).toBe(true);
  });
});

describe("buildAgentDayView — products", () => {
  it("withholds a per-product rate below the significance threshold", () => {
    // 14 Aug in production: the day total clears 10 treated but no single
    // product does, so every product row must show a fraction, not a percent.
    const v = buildAgentDayView(
      detail({
        products: [
          { key: "p1", name: "A", image_url: null, calls: 49, attempted: 17, touched: 17, treated: 7, confirmed: 2, uploaded: 2 },
          { key: "p2", name: "B", image_url: null, calls: 31, attempted: 12, touched: 12, treated: 12, confirmed: 6, uploaded: 5 },
        ],
      }),
    );
    expect(v.products[0].uploadRate).toBeNull();
    expect(v.products[1].uploadRate).toBeCloseTo(41.7, 1);
  });
});

describe("buildAgentDayView — hours", () => {
  it("zero-fills all 24 hours so the strip never has holes", () => {
    const v = buildAgentDayView(
      detail({ hourly: [{ hour: 15, active_minutes: 40, treated: 3, confirmed: 1 }], late_hours: { "15": 2 } }),
    );
    expect(v.hours).toHaveLength(24);
    expect(v.hours[0]).toMatchObject({ hour: 0, active_minutes: 0, lateCallbacks: 0 });
    expect(v.hours[15]).toMatchObject({ hour: 15, active_minutes: 40, lateCallbacks: 2 });
  });
});

describe("buildAgentDayView — takeaways", () => {
  it("flags confirmations that never reached the carrier", () => {
    const v = buildAgentDayView(
      detail({ totals: { ...detail().totals, treated: 20, confirmed: 10, uploaded: 8, stuck_confirmed: 2 } }),
    );
    const stuck = v.takeaways.find((t) => t.kind === "stuck");
    expect(stuck).toBeDefined();
    expect(stuck?.tone).toBe("bad");
    expect(stuck?.count).toBe(2);
  });

  it("stays quiet about stuck uploads when everything shipped", () => {
    const v = buildAgentDayView(
      detail({ totals: { ...detail().totals, treated: 20, confirmed: 10, uploaded: 10 } }),
    );
    expect(v.takeaways.find((t) => t.kind === "stuck")).toBeUndefined();
  });

  it("flags rejections that hide behind a vague reason", () => {
    const v = buildAgentDayView(
      detail({ motifs: [{ reason: "autre", n: 7 }, { reason: "prix", n: 1 }] }),
    );
    const vague = v.takeaways.find((t) => t.kind === "vague_reason");
    expect(vague?.tone).toBe("bad");
  });

  it("does not flag rejection reasons when they are specific", () => {
    const v = buildAgentDayView(
      detail({ motifs: [{ reason: "prix", n: 6 }, { reason: "autre", n: 1 }] }),
    );
    expect(v.takeaways.find((t) => t.kind === "vague_reason")?.tone).toBe("ok");
  });

  it("describes slow follow-ups and abandoned ones differently", () => {
    const slow = buildAgentDayView(
      detail({ cadence: { judged: 20, late: 12, median_gap_min: 200, tiers: { ok: 8, late: 10, abandoned: 2 }, orders: [] } }),
    );
    const abandoned = buildAgentDayView(
      detail({ cadence: { judged: 17, late: 13, median_gap_min: 2827, tiers: { ok: 4, late: 3, abandoned: 10 }, orders: [] } }),
    );
    expect(slow.takeaways.find((t) => t.kind === "cadence")?.variant).toBe("late");
    expect(abandoned.takeaways.find((t) => t.kind === "cadence")?.variant).toBe("abandoned");
  });
});

describe("buildAgentDayView — end-of-day queue", () => {
  it("splits the queue into exhausted, last-chance and healthy bands", () => {
    const v = buildAgentDayView(
      detail({
        targets: { daily_treated: 12, min_rate: 40, conf_per_hour: 3, max_attempts: 8 },
        queue_end_of_day: {
          open: 9, uploaded: 11, rejected: 15,
          by_attempts_left: [{ attempts_left: 0, n: 1 }, { attempts_left: 4, n: 2 }, { attempts_left: 5, n: 6 }],
        },
      }),
    );
    expect(v.queue.exhausted).toBe(1);
    expect(v.queue.lastChance).toBe(0);
    expect(v.queue.healthy).toBe(8);
    // every bucket from 0..max_attempts is present so the histogram has an axis
    expect(v.queue.buckets).toHaveLength(9);
    expect(v.queue.buckets[0]).toMatchObject({ attemptsLeft: 0, n: 1, band: "exhausted" });
  });

  it("counts one and two attempts left as the last chance band", () => {
    const v = buildAgentDayView(
      detail({
        queue_end_of_day: {
          open: 3, uploaded: 0, rejected: 0,
          by_attempts_left: [{ attempts_left: 1, n: 2 }, { attempts_left: 2, n: 1 }],
        },
      }),
    );
    expect(v.queue.lastChance).toBe(3);
    expect(v.queue.exhausted).toBe(0);
  });
});
