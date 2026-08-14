import { describe, it, expect } from "vitest";
import {
  effectiveWindowDays,
  demandRatePerDay,
  demandConfidence,
  daysOfCover,
  addDaysISO,
  daysBetweenISO,
  stockOutDate,
  reorderByDate,
  returnRate,
  computeDrift,
  chooseBucketDays,
  classifyStockState,
  splitCapital,
  damagedRate,
  isDamagedOutlier,
} from "../inventory-intelligence";
import { CONFIDENCE_LOW_MIN, CONFIDENCE_OK_MIN } from "@/lib/dashboard/confidence";

const NOW = new Date("2026-08-14T12:00:00Z");
const TODAY = "2026-08-14";

describe("effectiveWindowDays", () => {
  it("narrows the window to the product's actual selling life", () => {
    // A product first shipped 3 days into a 90-day window sells at units/3, not
    // units/90 — the latter reports a thirtieth of the truth and hides a stockout.
    expect(effectiveWindowDays(90, "2026-08-11T00:00:00Z", NOW)).toBe(3);
  });
  it("never exceeds the nominal window", () => {
    expect(effectiveWindowDays(28, "2026-01-01T00:00:00Z", NOW)).toBe(28);
  });
  it("falls back to the nominal window when nothing has shipped", () => {
    expect(effectiveWindowDays(28, null, NOW)).toBe(28);
  });
  it("never returns zero, even for a shipment made today", () => {
    expect(effectiveWindowDays(28, "2026-08-14T09:00:00Z", NOW)).toBe(1);
  });
});

describe("demandRatePerDay", () => {
  it("divides units by the effective window", () => {
    expect(demandRatePerDay(28, 28)).toBe(1);
  });
  it("is zero when there is no demand", () => {
    expect(demandRatePerDay(0, 28)).toBe(0);
  });
  it("is zero rather than infinite when the window collapses", () => {
    expect(demandRatePerDay(10, 0)).toBe(0);
  });
});

describe("demandConfidence", () => {
  it("refuses to judge an empty sample", () => {
    expect(demandConfidence(0)).toBe("none");
  });
  it("refuses just below the low threshold", () => {
    expect(demandConfidence(CONFIDENCE_LOW_MIN - 1)).toBe("none");
  });
  it("is low at the low threshold", () => {
    expect(demandConfidence(CONFIDENCE_LOW_MIN)).toBe("low");
  });
  it("is ok at the ok threshold", () => {
    expect(demandConfidence(CONFIDENCE_OK_MIN)).toBe("ok");
  });
  it("uses the shared dashboard thresholds, not its own literals", () => {
    expect(demandConfidence(CONFIDENCE_OK_MIN - 1)).toBe("low");
  });
});

describe("daysOfCover", () => {
  it("divides free-to-sell by the daily rate", () => {
    expect(daysOfCover(60, 2)).toBe(30);
  });
  it("floors a fractional result", () => {
    expect(daysOfCover(10, 3)).toBe(3);
  });
  it("is unknowable — not infinite — when nothing sells", () => {
    expect(daysOfCover(10, 0)).toBeNull();
  });
  it("is zero when there is nothing free to sell", () => {
    expect(daysOfCover(0, 2)).toBe(0);
  });
  it("reads zero, never negative, when a product is oversold", () => {
    // صغير in production: 216 in the register against 239 committed.
    expect(daysOfCover(-23, 2)).toBe(0);
  });
});

describe("date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDaysISO("2026-08-28", 10)).toBe("2026-09-07");
  });
  it("subtracts with a negative offset", () => {
    expect(addDaysISO("2026-09-07", -14)).toBe("2026-08-24");
  });
  it("counts whole days between two dates", () => {
    expect(daysBetweenISO("2026-08-14", "2026-09-07")).toBe(24);
  });
  it("returns a negative count when the target is in the past", () => {
    expect(daysBetweenISO("2026-08-14", "2026-08-10")).toBe(-4);
  });
});

describe("stockOutDate", () => {
  it("projects the cover forward from today", () => {
    expect(stockOutDate(TODAY, 10)).toBe("2026-08-24");
  });
  it("is null when cover is unknowable", () => {
    expect(stockOutDate(TODAY, null)).toBeNull();
  });
  it("is today when there is no cover left", () => {
    expect(stockOutDate(TODAY, 0)).toBe(TODAY);
  });
});

describe("reorderByDate", () => {
  it("backs the lead time off the stock-out date", () => {
    expect(reorderByDate("2026-08-24", 14)).toBe("2026-08-10");
  });
  it("is null when there is no stock-out date", () => {
    expect(reorderByDate(null, 14)).toBeNull();
  });
  it("returns a date in the past rather than clamping to today", () => {
    // Clamping would erase the alarm: a stock-out inside the lead time means
    // the order is already late, and the page has to say so.
    expect(reorderByDate("2026-08-16", 14)).toBe("2026-08-02");
  });
});

describe("returnRate", () => {
  it("divides returns by everything that resolved", () => {
    expect(returnRate(3, 7)).toBe(0.3);
  });
  it("is null — not zero — when nothing has resolved", () => {
    expect(returnRate(0, 0)).toBeNull();
  });
});

describe("computeDrift", () => {
  const base = {
    currentStock: 100,
    ledgerSumUnits: 100,
    shippedUnitsAllTime: 0,
    returnedToShelfUnitsAllTime: 0,
    damagedReturnCount: 0,
    unitCost: 10,
  };

  it("reports no drift on a reconciled product", () => {
    expect(computeDrift(base).units).toBe(0);
  });

  it("measures the production case: stock shipped but never scanned", () => {
    // The number this redesign exists to surface.
    const d = computeDrift({ ...base, shippedUnitsAllTime: 507 });
    expect(d.expectedStock).toBe(-407);
    expect(d.units).toBe(507);
    expect(d.value).toBe(5070);
  });

  it("credits units that came back to the shelf", () => {
    const d = computeDrift({
      ...base,
      shippedUnitsAllTime: 50,
      returnedToShelfUnitsAllTime: 20,
    });
    expect(d.expectedStock).toBe(70);
    expect(d.units).toBe(30);
  });

  it("does not credit damaged returns — they never go back on the shelf", () => {
    const d = computeDrift({
      ...base,
      shippedUnitsAllTime: 50,
      returnedToShelfUnitsAllTime: 20,
      damagedReturnCount: 5,
    });
    expect(d.expectedStock).toBe(65);
  });
});

describe("chooseBucketDays", () => {
  it("buckets short windows by day", () => {
    expect(chooseBucketDays(7)).toBe(1);
    expect(chooseBucketDays(28)).toBe(1);
  });
  it("buckets a quarter by week so a sparkline stays readable", () => {
    expect(chooseBucketDays(90)).toBe(7);
  });
});

describe("classifyStockState", () => {
  const base = {
    freeToSell: 100,
    physicalStock: 100,
    demandUnits: 50,
    coverDays: 60 as number | null,
    reorderByDateISO: "2026-12-01" as string | null,
    todayISO: TODAY,
    leadTimeDays: 14,
    confidence: "ok" as const,
  };

  it("calls an oversold product out, however good its cover looks", () => {
    expect(classifyStockState({ ...base, freeToSell: -23, coverDays: 900 })).toBe("out");
  });
  it("calls a product with stock and zero demand dead", () => {
    expect(classifyStockState({ ...base, demandUnits: 0, coverDays: null, confidence: "none" })).toBe("dead");
  });
  it("prefers dead over unknown — zero demand is a fact, not a thin sample", () => {
    expect(
      classifyStockState({ ...base, demandUnits: 0, coverDays: null, confidence: "none" }),
    ).not.toBe("unknown");
  });
  it("admits it cannot judge a thin sample", () => {
    expect(classifyStockState({ ...base, demandUnits: 4, confidence: "none" })).toBe("unknown");
  });
  it("raises reorder_now once the reorder date has passed", () => {
    expect(classifyStockState({ ...base, reorderByDateISO: "2026-08-10" })).toBe("reorder_now");
  });
  it("watches a product that runs out soon", () => {
    expect(classifyStockState({ ...base, coverDays: 20, reorderByDateISO: "2026-09-01" })).toBe("watch");
  });
  it("flags capital sitting on a year of cover", () => {
    expect(classifyStockState({ ...base, coverDays: 761, reorderByDateISO: null })).toBe("overstocked");
  });
  it("leaves a healthy product alone", () => {
    expect(classifyStockState(base)).toBe("ok");
  });
});

describe("splitCapital", () => {
  it("partitions stock value into three buckets that sum to the whole", () => {
    const s = splitCapital({
      physicalStock: 600,
      committed: 29,
      ratePerDay: 0.75,
      unitCost: 30,
    });
    expect(s.engaged + s.active + s.dormant).toBeCloseTo(600 * 30, 6);
  });

  it("counts units on the road as engaged", () => {
    const s = splitCapital({ physicalStock: 600, committed: 29, ratePerDay: 0.75, unitCost: 30 });
    expect(s.engaged).toBe(29 * 30);
  });

  it("treats everything past 90 days of cover as dormant", () => {
    // كبير: 571 free at 0.75/day is 761 days of cover. 90 days is ~68 units.
    const s = splitCapital({ physicalStock: 600, committed: 29, ratePerDay: 0.75, unitCost: 30 });
    expect(s.active).toBe(68 * 30);
    expect(s.dormant).toBe(503 * 30);
  });

  it("calls the whole shelf dormant when nothing sells", () => {
    const s = splitCapital({ physicalStock: 1000, committed: 53, ratePerDay: 0, unitCost: 40 });
    expect(s.active).toBe(0);
    expect(s.dormant).toBe(947 * 40);
  });

  it("caps engaged at what is physically there when a product is oversold", () => {
    const s = splitCapital({ physicalStock: 216, committed: 239, ratePerDay: 2.18, unitCost: 25 });
    expect(s.engaged).toBe(216 * 25);
    expect(s.active).toBe(0);
    expect(s.dormant).toBe(0);
  });
});

describe("damagedRate", () => {
  it("divides damaged units by total returns", () => {
    expect(damagedRate(5, 20)).toBe(0.25);
  });
  it("is zero when there are no returns", () => {
    expect(damagedRate(5, 0)).toBe(0);
  });
});

describe("isDamagedOutlier", () => {
  it("flags a product at twice the mean", () => {
    expect(isDamagedOutlier(0.4, 0.2)).toBe(true);
  });
  it("ignores a rate below the noise floor", () => {
    expect(isDamagedOutlier(0.05, 0.02)).toBe(false);
  });
  it("ignores everything when there is no mean to compare against", () => {
    expect(isDamagedOutlier(0.4, 0)).toBe(false);
  });
});
