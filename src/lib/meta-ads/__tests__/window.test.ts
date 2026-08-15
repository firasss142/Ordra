import { describe, test, expect } from "vitest";
import { rollingWindow, sliceWindow, ROLLING_WINDOW_DAYS, MAX_SLICE_DAYS } from "../sync";

/**
 * The window is the difference between "this product has no ad spend" and "we
 * never asked Meta about it". A seven-day steady state is right for keeping up
 * with restatements and wrong for a first connection, so both shapes have to
 * behave — and a long range has to arrive in slices Meta will actually answer.
 */

const NOW = new Date("2026-08-15T10:00:00Z");

describe("rollingWindow", () => {
  test("is inclusive on both ends", () => {
    const w = rollingWindow(NOW);
    expect(w.until).toBe("2026-08-15");
    // 7 days INCLUDING today, so six days back, not seven.
    expect(w.since).toBe("2026-08-09");
    expect(ROLLING_WINDOW_DAYS).toBe(7);
  });

  test("reaches back further when asked", () => {
    expect(rollingWindow(NOW, 90).since).toBe("2026-05-18");
  });
});

describe("sliceWindow", () => {
  test("leaves a steady-state window as a single call", () => {
    const slices = sliceWindow("2026-08-09", "2026-08-15");
    expect(slices).toEqual([{ since: "2026-08-09", until: "2026-08-15" }]);
  });

  test("splits a 90-day backfill into answerable slices", () => {
    const slices = sliceWindow("2026-05-18", "2026-08-15");
    expect(slices).toHaveLength(3);
    // Oldest first: a deadline that cuts this short leaves a contiguous run
    // from the start rather than a hole in the middle.
    expect(slices[0].since).toBe("2026-05-18");
    expect(slices[slices.length - 1].until).toBe("2026-08-15");
  });

  test("covers every day exactly once, with no gap and no overlap", () => {
    const slices = sliceWindow("2026-05-18", "2026-08-15");
    for (let i = 1; i < slices.length; i++) {
      const prevEnd = new Date(`${slices[i - 1].until}T00:00:00Z`);
      const thisStart = new Date(`${slices[i].since}T00:00:00Z`);
      const gapDays = (thisStart.getTime() - prevEnd.getTime()) / 86_400_000;
      // Exactly one day on: touching, never overlapping. An overlap would be
      // harmless (the upsert dedupes) but a gap is a silent hole in spend.
      expect(gapDays).toBe(1);
    }
  });

  test("never exceeds the per-call limit", () => {
    for (const s of sliceWindow("2026-01-01", "2026-08-15")) {
      const days =
        (new Date(`${s.until}T00:00:00Z`).getTime() - new Date(`${s.since}T00:00:00Z`).getTime()) /
          86_400_000 +
        1;
      expect(days).toBeLessThanOrEqual(MAX_SLICE_DAYS);
    }
  });

  test("handles a single day", () => {
    expect(sliceWindow("2026-08-15", "2026-08-15")).toEqual([
      { since: "2026-08-15", until: "2026-08-15" },
    ]);
  });

  test("returns nothing for a reversed or unparseable range", () => {
    // Better an empty pass than a request Meta answers with someone else's dates.
    expect(sliceWindow("2026-08-15", "2026-08-01")).toEqual([]);
    expect(sliceWindow("not-a-date", "2026-08-01")).toEqual([]);
  });
});
