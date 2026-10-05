import { describe, expect, it } from "vitest";
import { buildStockView, classify, rebuyQty, type StockInput } from "./model";

const TRI = "tri", BGZ = "bgz";
const base = (o: Partial<StockInput> = {}): StockInput => ({
  today: "2026-10-04",
  windowDays: 28,
  leadTimeDays: 14,
  sites: [{ id: TRI, name: "Tripoli" }, { id: BGZ, name: "Benghazi" }],
  products: [
    // sells well: 3.5/day on the market, 300 units
    { id: "tad", name: "Tadabbur", image: null, cost: 62, price: 210, units: 290, rate: 5.9, daysSinceSale: 0, lastCounted: null, series: [] },
    // sleeps: sells, but 0.2/day for 80 units = 400 days
    { id: "gan", name: "Gants de boxe", image: null, cost: 38, price: 150, units: 80, rate: 0.2, daysSinceSale: 9, lastCounted: null, series: [] },
    // to liquidate: nothing for 61 days
    { id: "tap", name: "Tapis de prière", image: null, cost: 55, price: 190, units: 66, rate: 0, daysSinceSale: 61, lastCounted: "2026-09-01T10:00:00Z", series: [] },
  ],
  siteUnits: [
    { product: "tad", site: TRI, units: 210 },
    { product: "tad", site: BGZ, units: 60 },
    { product: "gan", site: TRI, units: 80 },
    { product: "tap", site: TRI, units: 52 },
  ],
  siteShipped: [
    { product: "tad", site: TRI, units: 67 },
    { product: "tad", site: BGZ, units: 98 },
    { product: "gan", site: TRI, units: 6 },
  ],
  onOrder: [],
  ...o,
});

describe("classify", () => {
  it("sells well when it sells and the stock lasts under 90 days", () => {
    expect(classify(2.4, 210, 0)).toBe("good");
  });
  it("sleeps when it sells but the stock would last more than 90 days", () => {
    expect(classify(0.2, 80, 9)).toBe("warn");
  });
  it("sleeps when nothing sold in the window but something sold within 60 days", () => {
    expect(classify(0, 63, 38)).toBe("warn");
  });
  it("is to liquidate after 60 days without a sale, or if it never sold", () => {
    expect(classify(0, 52, 61)).toBe("bad");
    expect(classify(0, 52, null)).toBe("bad");
  });
});

describe("rebuyQty", () => {
  it("buys enough for the lead time plus 45 days, rounded up to tens", () => {
    // 3.5/day × (14 + 45) = 206.5 − 60 in stock = 146.5 → 150
    expect(rebuyQty(3.5, 60, 14)).toBe(150);
  });
  it("never suggests fewer than 10", () => {
    expect(rebuyQty(0.1, 0, 14)).toBe(10);
  });
});

describe("buildStockView", () => {
  it("values the market at purchase price, warehouses plus the unplaced remainder", () => {
    const v = buildStockView(base());
    expect(v.total.value).toBe(290 * 62 + 80 * 38 + 66 * 55);
    expect(v.unassigned.value).toBe(20 * 62 + 14 * 55);
    expect(v.unassigned.products.map((p) => p.id)).toEqual(["tad", "tap"]);
    expect(v.sites.map((s) => s.value)).toEqual([210 * 62 + 80 * 38 + 52 * 55, 60 * 62]);
  });

  it("splits a product's sales rate between warehouses by what each one shipped", () => {
    const v = buildStockView(base());
    const tri = v.sites[0].all.find((r) => r.id === "tad")!;
    const bgz = v.sites[1].all.find((r) => r.id === "tad")!;
    expect(tri.rate + bgz.rate).toBeCloseTo(5.9, 5);
    expect(bgz.rate).toBeCloseTo(5.9 * (98 / 165), 5);
    expect(bgz.days).toBe(Math.round(60 / (5.9 * (98 / 165))));
  });

  it("puts each warehouse's money into the three states, and the market adds them up", () => {
    const v = buildStockView(base());
    const tri = v.sites[0];
    expect(tri.good).toBe(210 * 62);
    expect(tri.warn).toBe(80 * 38);
    expect(tri.bad).toBe(52 * 55);
    expect(v.total.good + v.total.warn + v.total.bad).toBe(v.total.value);
  });

  it("asks to rebuy what runs out inside the lead time plus a margin, with a budget", () => {
    const v = buildStockView(base());
    const bgz = v.sites[1];
    // Benghazi: 60 units at 3.5/day = 17 days ≤ 14 + 14
    expect(bgz.rebuy.map((r) => r.id)).toEqual(["tad"]);
    expect(bgz.rebuy[0].buy).toEqual({ qty: rebuyQty(bgz.rebuy[0].rate, 60, 14), cost: rebuyQty(bgz.rebuy[0].rate, 60, 14) * 62 });
    expect(bgz.budget).toBe(bgz.rebuy[0].buy!.cost);
    expect(v.sites[0].rebuy).toEqual([]);
  });

  it("shows what is already ordered instead of a suggestion, and warns when it lands after the shelf is empty", () => {
    const v = buildStockView(base({ onOrder: [{ product: "tad", site: BGZ, qty: 250, eta: "2026-11-05", ref: "BC-LY-2026-0014" }] }));
    const r = v.sites[1].rebuy[0];
    expect(r.buy).toBeNull();
    expect(r.order).toMatchObject({ qty: 250, eta: "2026-11-05", ref: "BC-LY-2026-0014", risk: true });
    expect(v.sites[1].budget).toBe(0);
  });

  it("lists what sleeps, biggest money first", () => {
    const v = buildStockView(base());
    expect(v.sites[0].sleep.map((r) => r.id)).toEqual(["gan", "tap"]);
  });

  it("gives the market's days of sales from the money that leaves per day", () => {
    const v = buildStockView(base());
    const perDay = 5.9 * 62 + 0.2 * 38;
    expect(v.total.days).toBe(Math.round(v.total.value / perDay));
    expect(v.total.sale).toBe(290 * 210 + 80 * 150 + 66 * 190);
  });
});
