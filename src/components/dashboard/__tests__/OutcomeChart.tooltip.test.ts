import { describe, test, expect } from "vitest";
import { tooltipRows } from "../charts/OutcomeChart";
import type { DailyPoint } from "@/lib/dashboard/health";

function point(over: Partial<DailyPoint> = {}): DailyPoint {
  return {
    day: "2026-08-12",
    delivered: 10,
    returned: 2,
    rejected: 3,
    open: 5,
    intake: 20,
    confirmed: 14,
    uploaded: 12,
    revenue: 4800,
    ...over,
  };
}

describe("tooltipRows", () => {
  // Five rows: the day's size, how much of it got agreed, then where the
  // resolved orders landed. `returned` and `uploaded` came off — returns are a
  // carrier outcome that lands weeks after the cohort day being hovered, and
  // uploaded read as a near-permanent 0 next to large rejected counts because
  // it is an event count on a day whose orders had not been uploaded yet.
  test("leads with intake and confirmed, then the outcome bands", () => {
    expect(tooltipRows(point()).rows.map((r) => [r.key, r.value])).toEqual([
      ["ordersCount", 20],
      ["confirmedEvents", 14],
      ["delivered", 10],
      ["rejected", 3],
      ["open", 5],
    ]);
  });

  // Every counted row carries a chip so the card reads as one list. Only the
  // intake row stays plain: it IS the bar, not a slice of it, and a swatch
  // would put it in the same visual class as the parts it contains.
  test("gives every counted row a colour except the intake total", () => {
    const rows = tooltipRows(point()).rows;
    expect(rows[0].color).toBeUndefined();
    expect(rows.slice(1).every((r) => typeof r.color === "string")).toBe(true);
  });

  // confirmed is an order_history EVENT count, not a segment of the stack, so
  // it must not borrow any band's colour — that would read as "this slice of
  // the bar", which is exactly what it is not.
  test("colours confirmed distinctly from every outcome band", () => {
    const rows = tooltipRows(point()).rows;
    const confirmed = rows.find((r) => r.key === "confirmedEvents");
    const bands = rows.filter((r) => r.key !== "confirmedEvents" && r.color);
    expect(confirmed?.color).toEqual(expect.any(String));
    expect(bands.map((b) => b.color)).not.toContain(confirmed?.color);
  });

  // The bar still stacks returned, so the visible rows deliberately do NOT sum
  // to intake. Asserting the gap keeps that a decision rather than a slip.
  test("does not claim the listed outcomes account for the whole bar", () => {
    const rows = tooltipRows(point()).rows;
    const bands = rows.slice(2).reduce((n, r) => n + r.value, 0);
    expect(bands).toBeLessThan(rows[0].value);
  });

  test("carries the day's revenue", () => {
    expect(tooltipRows(point({ revenue: 0 })).revenue).toBe(0);
    expect(tooltipRows(point()).revenue).toBe(4800);
  });

  // Rows cached by SWR from before the RPC gained these fields still render; a
  // zero is honest here, "NaN" in a tooltip is not.
  test("treats a missing confirmed count as zero rather than undefined", () => {
    const legacy = point();
    delete (legacy as Partial<DailyPoint>).confirmed;
    expect(tooltipRows(legacy).rows[1].value).toBe(0);
  });
});
