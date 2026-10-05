import { describe, expect, it } from "vitest";
import { monthWindows, toPnlMonth, per100, pickMonth } from "./months";
import type { ProfitabilitySummary } from "@/lib/profitability/load-summary";

const summary = (o: Partial<ProfitabilitySummary> = {}): ProfitabilitySummary => ({
  revenue: 101640,
  cogs: 28460,
  delivery_cost: 9980,
  return_cost: 1200,
  packing_cost: 3050,
  ad_spend: 34560,
  net_profit: 24390,
  margin: 24,
  delivered_count: 452,
  returned_count: 30,
  confirmed_count: 600,
  leads_count: 900,
  ...o,
});

describe("monthWindows", () => {
  it("gives the twelve closed months then the month in progress, oldest first", () => {
    const w = monthWindows("2026-10-04");
    expect(w).toHaveLength(13);
    expect(w[0]).toEqual({ key: "2025-10", from: "2025-10-01", to: "2025-10-31", live: false });
    expect(w[11]).toEqual({ key: "2026-09", from: "2026-09-01", to: "2026-09-30", live: false });
    expect(w[12]).toEqual({ key: "2026-10", from: "2026-10-01", to: "2026-10-04", live: true });
  });

  it("knows February and leap years, and crosses the year boundary", () => {
    const w = monthWindows("2028-03-02");
    expect(w.find((m) => m.key === "2028-02")?.to).toBe("2028-02-29");
    expect(w[0].key).toBe("2027-03");
    expect(w.find((m) => m.key === "2027-12")?.to).toBe("2027-12-31");
  });
});

describe("toPnlMonth", () => {
  it("folds return fees into Livraison so the four streams and the profit add up to what was paid", () => {
    const m = toPnlMonth(summary(), { key: "2026-09", from: "2026-09-01", to: "2026-09-30", live: false });
    expect(m).toEqual({
      key: "2026-09",
      live: false,
      to: "2026-09-30",
      paid: 101640,
      cogs: 28460,
      ship: 11180,
      ads: 34560,
      pack: 3050,
      profit: 24390,
      orders: 452,
    });
    expect(m.cogs + m.ship + m.ads + m.pack + m.profit).toBe(m.paid);
  });

  it("keeps a loss negative", () => {
    const m = toPnlMonth(summary({ revenue: 1000, cogs: 400, delivery_cost: 200, return_cost: 0, packing_cost: 50, ad_spend: 600, net_profit: -250 }), {
      key: "2026-10", from: "2026-10-01", to: "2026-10-04", live: true,
    });
    expect(m.profit).toBe(-250);
    expect(m.live).toBe(true);
  });
});

describe("per100", () => {
  it("says how many of every 100 dinars paid", () => {
    expect(per100(24390, 101640)).toBe(24);
    expect(per100(34560, 101640)).toBe(34);
  });
  it("is 0 when nothing was paid", () => {
    expect(per100(0, 0)).toBe(0);
  });
});

describe("pickMonth", () => {
  const keys = ["2026-08", "2026-09", "2026-10"].map((key, i) => ({ key, live: i === 2 }));
  it("opens on the requested month when it is in the list", () => {
    expect(pickMonth(keys, "2026-08")).toBe(0);
  });
  it("otherwise opens on the last closed month — a closed month is the answer, not four days", () => {
    expect(pickMonth(keys, null)).toBe(1);
    expect(pickMonth(keys, "1999-01")).toBe(1);
  });
});
