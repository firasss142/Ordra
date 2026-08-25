import { describe, it, expect } from "vitest";
import { buildWarehouseTrend } from "../summary";

/**
 * The 14-day trend behind the dashboard sparklines.
 *
 * The RPC only returns days that had activity. The zero-fill is the whole
 * point: a sparkline drawn from four sparse points would compress a quiet
 * fortnight into a jagged line that looks like constant movement.
 */
describe("buildWarehouseTrend", () => {
  it("emits one point per day in the window, including silent ones", () => {
    const points = buildWarehouseTrend([], "2026-08-01", "2026-08-14");
    expect(points).toHaveLength(14);
    expect(points.every((p) => p.scanned === 0 && p.handed === 0)).toBe(true);
  });

  it("carries handovers, which move no stock and come from order_history", () => {
    const points = buildWarehouseTrend(
      [{ day: "2026-08-02", scanned: 5, returned: 1, damaged: 0, handed: 3 }],
      "2026-08-01",
      "2026-08-03",
    );
    expect(points.find((p) => p.day === "2026-08-02")).toMatchObject({
      scanned: 5,
      handed: 3,
    });
  });

  it("treats a day with movement but no handover as zero, not missing", () => {
    const points = buildWarehouseTrend(
      [{ day: "2026-08-02", scanned: 5, returned: 0, damaged: 0, handed: 0 }],
      "2026-08-01",
      "2026-08-03",
    );
    expect(points.find((p) => p.day === "2026-08-02")!.handed).toBe(0);
  });

  it("keeps the points in chronological order", () => {
    const points = buildWarehouseTrend([], "2026-08-01", "2026-08-05");
    expect(points.map((p) => p.day)).toEqual([
      "2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05",
    ]);
  });
});
