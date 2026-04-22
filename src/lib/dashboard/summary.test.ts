import { describe, it, expect } from "vitest";
import {
  aggregateRejectionBreakdown,
  aggregatePeriodCounts,
  buildDailyTrend,
  computeDelta,
  previousPeriod,
  type HistoryRow,
} from "./summary";

function row(partial: Partial<HistoryRow>): HistoryRow {
  return {
    status_to: partial.status_to ?? "confirmed",
    created_at: partial.created_at ?? "2026-04-01T10:00:00Z",
    actor_id: partial.actor_id ?? null,
    order_id: partial.order_id ?? null,
    rejection_reason: partial.rejection_reason ?? null,
    market_id: partial.market_id ?? null,
  };
}

describe("aggregateRejectionBreakdown", () => {
  it("returns 0-count rows for all 7 reasons when none rejected", () => {
    const out = aggregateRejectionBreakdown([row({ status_to: "confirmed" })]);
    expect(out).toHaveLength(7);
    expect(out.every((r) => r.count === 0 && r.pct === 0)).toBe(true);
  });

  it("computes percentages that sum to ~100", () => {
    const rows: HistoryRow[] = [
      row({ status_to: "rejected", rejection_reason: "refus_client" }),
      row({ status_to: "rejected", rejection_reason: "refus_client" }),
      row({ status_to: "rejected", rejection_reason: "injoignable" }),
      row({ status_to: "rejected", rejection_reason: "autre" }),
    ];
    const out = aggregateRejectionBreakdown(rows);
    const refus = out.find((r) => r.reason === "refus_client")!;
    expect(refus.count).toBe(2);
    expect(refus.pct).toBe(50.0);
    expect(out.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100.0, 1);
  });

  it("ignores rejected rows without a reason", () => {
    const out = aggregateRejectionBreakdown([
      row({ status_to: "rejected", rejection_reason: null }),
      row({ status_to: "rejected", rejection_reason: "prix" }),
    ]);
    expect(out.find((r) => r.reason === "prix")!.pct).toBe(100.0);
  });
});

describe("aggregatePeriodCounts", () => {
  it("counts confirmed, dispatched, rejected, and attempts separately", () => {
    const counts = aggregatePeriodCounts([
      row({ status_to: "confirmed" }),
      row({ status_to: "dispatched" }),
      row({ status_to: "rejected" }),
      row({ status_to: "rejected" }),
      row({ status_to: "attempt_1" }),
      row({ status_to: "new" }),
    ]);
    expect(counts.actioned).toBe(4);
    expect(counts.confirmed).toBe(2);
    expect(counts.rejected).toBe(2);
  });

  it("returns zeroes on empty input", () => {
    expect(aggregatePeriodCounts([])).toEqual({ actioned: 0, confirmed: 0, rejected: 0 });
  });
});

describe("buildDailyTrend", () => {
  it("emits one point per day in inclusive range", () => {
    const out = buildDailyTrend([], "2026-04-01", "2026-04-03");
    expect(out.map((p) => p.day)).toEqual(["2026-04-01", "2026-04-02", "2026-04-03"]);
  });

  it("computes per-day confirmation and rejection rates", () => {
    const out = buildDailyTrend(
      [
        row({ status_to: "confirmed", created_at: "2026-04-01T09:00:00Z" }),
        row({ status_to: "rejected", created_at: "2026-04-01T15:00:00Z" }),
        row({ status_to: "confirmed", created_at: "2026-04-02T10:00:00Z" }),
      ],
      "2026-04-01",
      "2026-04-02",
    );
    expect(out[0].confRate).toBe(50.0);
    expect(out[0].rejRate).toBe(50.0);
    expect(out[1].confRate).toBe(100.0);
    expect(out[1].rejRate).toBe(0);
  });

  it("fills revenue from the provided map", () => {
    const revenueByDay = new Map([["2026-04-01", 125.5]]);
    const out = buildDailyTrend(
      [row({ status_to: "confirmed", created_at: "2026-04-01T09:00:00Z" })],
      "2026-04-01",
      "2026-04-01",
      revenueByDay,
    );
    expect(out[0].revenue).toBe(125.5);
  });
});

describe("computeDelta", () => {
  it("computes absolute delta and percentage", () => {
    expect(computeDelta(120, 100)).toEqual({ current: 120, previous: 100, delta: 20, deltaPct: 20.0 });
  });

  it("returns null deltaPct when previous is zero", () => {
    expect(computeDelta(5, 0).deltaPct).toBeNull();
  });

  it("handles negative deltas", () => {
    expect(computeDelta(50, 100)).toEqual({
      current: 50,
      previous: 100,
      delta: -50,
      deltaPct: -50.0,
    });
  });
});

describe("previousPeriod", () => {
  it("returns a same-duration window ending one day before fromDate", () => {
    const prev = previousPeriod("2026-04-10", "2026-04-14"); // 5-day window
    expect(prev.to).toBe("2026-04-09");
    expect(prev.from).toBe("2026-04-05");
  });

  it("handles a single-day period", () => {
    const prev = previousPeriod("2026-04-10", "2026-04-10");
    expect(prev).toEqual({ from: "2026-04-09", to: "2026-04-09" });
  });
});
