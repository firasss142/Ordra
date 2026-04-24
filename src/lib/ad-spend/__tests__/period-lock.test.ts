import { describe, it, expect } from "vitest";
import { isPeriodLocked, currentQuarterStartISO } from "../period-lock";

describe("period-lock — closed-quarter logic", () => {
  it("a date in the current quarter is NOT locked", () => {
    const today = new Date("2026-04-23T00:00:00Z");
    // Q2 2026 (Apr–Jun) is current. 2026-05-15 is in current quarter.
    expect(isPeriodLocked("2026-05-15", today)).toBe(false);
  });

  it("a date in the quarter immediately before current is NOT locked (just-closed grace — last quarter stays editable)", () => {
    const today = new Date("2026-04-23T00:00:00Z");
    // Q1 2026 (Jan–Mar) — considered last quarter, editable per brief
    expect(isPeriodLocked("2026-02-10", today)).toBe(false);
  });

  it("a date two quarters before current IS locked", () => {
    const today = new Date("2026-04-23T00:00:00Z");
    // Q4 2025 (Oct–Dec) — two quarters back, locked
    expect(isPeriodLocked("2025-11-15", today)).toBe(true);
  });

  it("a date from a prior year is locked", () => {
    const today = new Date("2026-04-23T00:00:00Z");
    expect(isPeriodLocked("2024-06-01", today)).toBe(true);
  });

  it("currentQuarterStartISO returns Jan 1 for Q1", () => {
    expect(currentQuarterStartISO(new Date("2026-02-14T00:00:00Z"))).toBe("2026-01-01");
  });

  it("currentQuarterStartISO returns Apr 1 for Q2", () => {
    expect(currentQuarterStartISO(new Date("2026-04-23T00:00:00Z"))).toBe("2026-04-01");
  });

  it("currentQuarterStartISO returns Jul 1 for Q3", () => {
    expect(currentQuarterStartISO(new Date("2026-08-01T00:00:00Z"))).toBe("2026-07-01");
  });

  it("currentQuarterStartISO returns Oct 1 for Q4", () => {
    expect(currentQuarterStartISO(new Date("2026-12-31T00:00:00Z"))).toBe("2026-10-01");
  });

  it("the boundary — last day of the locked quarter is locked", () => {
    // Today is 2026-04-23 (Q2). Last quarter is Q1 (Jan-Mar) — editable.
    // Two quarters back = Q4 2025 (Oct-Dec). 2025-12-31 = last day of Q4 2025 = locked.
    const today = new Date("2026-04-23T00:00:00Z");
    expect(isPeriodLocked("2025-12-31", today)).toBe(true);
  });

  it("the boundary — first day of last quarter is NOT locked", () => {
    const today = new Date("2026-04-23T00:00:00Z");
    // 2026-01-01 = first day of Q1 2026 = last quarter, editable
    expect(isPeriodLocked("2026-01-01", today)).toBe(false);
  });
});
