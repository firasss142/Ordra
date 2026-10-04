import { describe, test, expect } from "vitest";
import { buildPanelView } from "./panel-view";
import type { AgentPanel, PanelCommission } from "./types";

const COMM: PanelCommission = {
  currency: "LYD",
  enabled: true,
  rate: 10,
  rate_since: "2026-09-30",
  balance: 363,
  earned: 1074,
  earned_n: 118,
  back: 144,
  back_n: 16,
  paid: 567,
  paid_n: 2,
  entries: 136,
  days: [
    { day: "2026-09-25", net: 0, paid: 0 },
    { day: "2026-09-26", net: 20, paid: 267 },
    { day: "2026-09-27", net: -9, paid: 0 },
    { day: "2026-09-28", net: 120, paid: 0 },
  ],
  sum_14: 131,
  in_flight: 10,
  in_flight_late: 6,
  coming: 100,
  last_payout: { at: "2026-09-26T10:00:00Z", amount: 267 },
};

function panel(o: Partial<AgentPanel> = {}): AgentPanel {
  return {
    market_id: "ly",
    agent_id: "a",
    from: "2026-09-27",
    to: "2026-10-03",
    today: "2026-10-03",
    tz: "Africa/Tripoli",
    products: [
      { product_id: "m", name: "مصحف التهجد", image_url: null, assigned: 25, uploaded: 9, rejected: 9, attempts: 57 },
      { product_id: "q", name: "القرآن تدبر وعمل", image_url: null, assigned: 13, uploaded: 2, rejected: 9, attempts: 15 },
      { product_id: "h", name: "كتاب الحفظ", image_url: null, assigned: 7, uploaded: 0, rejected: 0, attempts: 11 },
    ],
    rejections: [
      { group: "autre", n: 26 },
      { group: "refus_client", n: 1 },
    ],
    delivered_30: { delivered: 144, returned: 86, en_route: 11 },
    commission: COMM,
    ...o,
  };
}

describe("the agent panel", () => {
  test("the four numbers are the sum of her products, the rate is uploaded ÷ decided", () => {
    const v = buildPanelView(panel());
    expect(v.totals).toEqual({ assigned: 45, uploaded: 11, rejected: 18, attempts: 83 });
    expect(Math.round(v.rate!)).toBe(38);
  });

  test("each product carries its rate and a bar on one scale; no decision = no rate", () => {
    const v = buildPanelView(panel());
    expect(v.products.map((p) => [p.key, p.decided, p.rate === null ? null : Math.round(p.rate)])).toEqual([
      ["m", 18, 50],
      ["q", 11, 18],
      ["h", 0, null],
    ]);
    expect(v.products[0].barPct).toBe(100);
    expect(Math.round(v.products[1].barPct)).toBe(61);
    expect(v.products[2].barPct).toBe(4); // a stub, so the row is never empty
  });

  test("rejection groups: ranked, with share and a bar on the biggest", () => {
    const v = buildPanelView(panel());
    expect(v.rejections.total).toBe(27);
    expect(v.rejections.rows.map((r) => [r.group, r.n, Math.round(r.pct), Math.round(r.barPct)])).toEqual([
      ["autre", 26, 96, 100],
      ["refus_client", 1, 4, 4],
    ]);
  });

  test("the 14-day bars never go below zero, and pay days are marked", () => {
    const v = buildPanelView(panel());
    expect(v.commission.bars.map((b) => [b.day, Math.round(b.heightPct), b.payday])).toEqual([
      ["2026-09-25", 0, false],
      ["2026-09-26", 17, true],
      ["2026-09-27", 0, false],
      ["2026-09-28", 100, false],
    ]);
    expect(v.commission.sum_14).toBe(131);
  });

  test("commission off only when there is no rate AND nothing was ever written", () => {
    expect(buildPanelView(panel()).commission.off).toBe(false);
    expect(buildPanelView(panel({ commission: { ...COMM, enabled: false, entries: 0, balance: 0 } })).commission.off).toBe(true);
    expect(buildPanelView(panel({ commission: { ...COMM, enabled: false } })).commission.off).toBe(false);
  });

  test("her uploads of the last 30 days split delivered / returned / en route", () => {
    const v = buildPanelView(panel());
    expect(v.delivered30).toEqual({ delivered: 144, returned: 86, enRoute: 11, total: 241 });
  });
});
