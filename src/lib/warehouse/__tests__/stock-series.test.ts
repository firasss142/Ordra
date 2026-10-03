import { describe, it, expect } from "vitest";
import { lastDays, stockSeries } from "../stock-series";

/**
 * The 14-day line on every stock row: the product's balance at the END of each
 * day, read from `inventory_log.balance_after` and carried forward.
 *
 * THE BUG THIS FIXES. `get_product_stock_series` filled a day that had no
 * movement on or before it with TODAY's stock. On 2026-10-02 the Coran lost 14
 * units in the day (943 → 929) and its line was flat at 929 for all fourteen
 * days: the drop the line exists to show was erased. The balance before the
 * first movement is that movement's `balance_after − change`.
 */

const TZ = "Africa/Tripoli";

describe("lastDays", () => {
  it("lists N market days, oldest first, ending today in the market's zone", () => {
    // 23:30 UTC on the 2nd is already the 3rd in Tripoli (UTC+2).
    const days = lastDays(3, TZ, new Date("2026-10-02T23:30:00Z"));
    expect(days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  });
});

describe("stockSeries", () => {
  const days = ["2026-09-30", "2026-10-01", "2026-10-02"];

  it("is flat at the current stock when nothing moved", () => {
    expect(stockSeries([], 216, days, TZ)).toEqual([216, 216, 216]);
  });

  it("starts at the balance before the first movement, not at today's stock", () => {
    const rows = [
      { change: -1, balance_after: 942, created_at: "2026-10-02T08:00:00Z" },
      { change: -1, balance_after: 941, created_at: "2026-10-02T09:00:00Z" },
    ];
    expect(stockSeries(rows, 941, days, TZ)).toEqual([943, 943, 941]);
  });

  it("carries a day's closing balance forward across quiet days", () => {
    const rows = [
      { change: 100, balance_after: 300, created_at: "2026-09-30T10:00:00Z" },
      { change: -5, balance_after: 295, created_at: "2026-10-02T10:00:00Z" },
    ];
    expect(stockSeries(rows, 295, days, TZ)).toEqual([300, 300, 295]);
  });

  it("uses a movement from before the window as the opening balance", () => {
    const rows = [
      { change: 50, balance_after: 50, created_at: "2026-09-20T10:00:00Z" },
      { change: -2, balance_after: 48, created_at: "2026-10-01T10:00:00Z" },
    ];
    expect(stockSeries(rows, 48, days, TZ)).toEqual([50, 48, 48]);
  });

  it("closes a day in the market's zone, not in UTC", () => {
    // 22:30 UTC on 30 Sept is 00:30 on 1 Oct in Tripoli.
    const rows = [{ change: -1, balance_after: 9, created_at: "2026-09-30T22:30:00Z" }];
    expect(stockSeries(rows, 9, days, TZ)).toEqual([10, 9, 9]);
  });
});
