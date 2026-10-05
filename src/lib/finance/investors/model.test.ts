import { describe, expect, it } from "vitest";
import { buildInvestorsView, nextPayout, type InvestorsInput } from "./model";

// Ahmed: 40 % of Tadabbur since 1 May; September is the last closed month.
const day = (d: string, share: number, net = share / 0.4) => ({ d, share, net });
const input = (o: Partial<InvestorsInput> = {}): InvestorsInput => ({
  today: "2026-10-04",
  investors: [
    { id: "a", name: "Ahmed B.", method: "bank_transfer" },
    { id: "h", name: "Hana M.", method: null },
  ],
  deals: [
    { id: "d1", investorId: "a", productName: "Tadabbur", productImage: null, status: "active", start: "2026-05-01", end: "2027-03-31", sharePct: 40, capital: 30000, cadence: "monthly" },
    { id: "d2", investorId: "h", productName: "Coran couleurs", productImage: null, status: "active", start: "2026-08-01", end: "2027-07-31", sharePct: 35, capital: 20000, cadence: "quarterly" },
  ],
  series: [
    { dealId: "d1", days: [day("2026-05-10", 1240), day("2026-06-10", 1560), day("2026-07-10", 1840), day("2026-08-10", 2120), day("2026-09-10", 2000), day("2026-09-20", 880), day("2026-10-02", 300)] },
    { dealId: "d2", days: [day("2026-08-15", 910, 2600), day("2026-09-15", 1085, 3100)] },
  ],
  statements: [
    { dealId: "d1", periodEnd: "2026-08-31", share: 6760, settledAt: "2026-09-03T10:00:00Z" },
  ],
  withdrawals: [
    { investorId: "a", amount: 6760, paidAt: "2026-09-30T10:00:00Z" },
  ],
  ...o,
});

describe("buildInvestorsView", () => {
  it("counts only closed months: September is in, the days of October are not", () => {
    const v = buildInvestorsView(input());
    const a = v.investors.find((x) => x.id === "a")!;
    expect(v.lastClosed).toBe("2026-09");
    expect(a.earned).toBe(1240 + 1560 + 1840 + 2120 + 2880);
    expect(a.months.map((m) => [m.key, m.share])).toEqual([
      ["2026-05", 1240], ["2026-06", 1560], ["2026-07", 1840], ["2026-08", 2120], ["2026-09", 2880],
    ]);
  });

  it("earned = already paid + still to pay", () => {
    const a = buildInvestorsView(input()).investors.find((x) => x.id === "a")!;
    expect(a.paid).toBe(6760);
    expect(a.due).toBe(a.earned - a.paid);
  });

  it("a month is settled once a statement covers it", () => {
    const a = buildInvestorsView(input()).investors.find((x) => x.id === "a")!;
    expect(a.months.map((m) => m.settled)).toEqual([true, true, true, true, false]);
  });

  it("adds the people up in the overview", () => {
    const v = buildInvestorsView(input());
    expect(v.overview.capital).toBe(50000);
    expect(v.overview.earned).toBe(9640 + 1995);
    expect(v.overview.paid).toBe(6760);
    expect(v.overview.due).toBe(9640 + 1995 - 6760);
  });

  it("asks to close what is earned but not yet in a statement", () => {
    const v = buildInvestorsView(input());
    expect(v.todo).toEqual({ month: "2026-09", people: ["a", "h"], amount: 2880 + 1995 });
  });

  it("says nothing to do when every closed month is in a statement", () => {
    const v = buildInvestorsView(input({
      statements: [
        { dealId: "d1", periodEnd: "2026-09-30", share: 9640, settledAt: "2026-10-01T10:00:00Z" },
        { dealId: "d2", periodEnd: "2026-09-30", share: 1995, settledAt: "2026-10-01T10:00:00Z" },
      ],
    }));
    expect(v.todo).toBeNull();
  });

  it("gives each deal where it stands in its term", () => {
    const a = buildInvestorsView(input()).investors.find((x) => x.id === "a")!;
    expect(a.deals[0]).toMatchObject({ monthIdx: 6, monthsTotal: 11, last: { key: "2026-09", share: 2880, profit: 7200 } });
    expect(a.deals[0].elapsedPct).toBeGreaterThan(45);
    expect(a.deals[0].elapsedPct).toBeLessThan(50);
  });

  it("gives each person a colour of their own, in order", () => {
    expect(buildInvestorsView(input()).investors.map((x) => x.hue)).toEqual(["indigo", "pink"]);
  });

  it("returns on capital = earned ÷ capital", () => {
    const a = buildInvestorsView(input()).investors.find((x) => x.id === "a")!;
    expect(a.roc).toBeCloseTo((9640 / 30000) * 100, 5);
  });
});

describe("nextPayout", () => {
  it("monthly falls at the end of this month, quarterly at the end of the quarter", () => {
    expect(nextPayout("monthly", "2026-10-04")).toBe("2026-10-31");
    expect(nextPayout("quarterly", "2026-10-04")).toBe("2026-12-31");
    expect(nextPayout("semiannual", "2026-10-04")).toBe("2026-12-31");
    expect(nextPayout("annual", "2026-03-04")).toBe("2026-12-31");
  });
  it("at maturity has no date until the end", () => {
    expect(nextPayout("at_maturity", "2026-10-04")).toBeNull();
  });
});
