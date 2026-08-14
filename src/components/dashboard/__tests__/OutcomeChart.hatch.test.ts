import { describe, test, expect } from "vitest";
import { unresolvedTailStart } from "../charts/OutcomeChart";
import type { DailyPoint } from "@/lib/dashboard/health";

function day(d: string, open: number): DailyPoint {
  return {
    day: d,
    delivered: 10,
    returned: 1,
    rejected: 1,
    open,
    intake: 12 + open,
    confirmed: 8,
    revenue: 500,
  };
}

describe("unresolvedTailStart", () => {
  // Recent cohorts legitimately still have orders in flight. The hatch marks
  // exactly those days so the shape's caveat arrives with the shape.
  test("marks the trailing run of days that still have open orders", () => {
    expect(
      unresolvedTailStart([
        day("2026-08-01", 0),
        day("2026-08-02", 0),
        day("2026-08-03", 4),
        day("2026-08-04", 9),
      ]),
    ).toBe("2026-08-03");
  });

  test("marks nothing when every day has resolved", () => {
    expect(unresolvedTailStart([day("2026-08-01", 0), day("2026-08-02", 0)])).toBeNull();
  });

  // A band over every bar marks nothing, and reads as "none of this is
  // trustworthy" about a chart we are nonetheless asking people to read.
  test("marks nothing when the whole window is unresolved", () => {
    expect(unresolvedTailStart([day("2026-08-01", 3), day("2026-08-02", 5)])).toBeNull();
  });

  // Only the TAIL counts. An older day that never resolved is a data problem,
  // not evidence that today's bar is still settling.
  test("ignores an unresolved day that is followed by a resolved one", () => {
    expect(
      unresolvedTailStart([day("2026-08-01", 7), day("2026-08-02", 0), day("2026-08-03", 2)]),
    ).toBe("2026-08-03");
  });

  test("handles an empty window", () => {
    expect(unresolvedTailStart([])).toBeNull();
  });
});
