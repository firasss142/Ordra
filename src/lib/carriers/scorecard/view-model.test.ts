import { describe, it, expect } from "vitest";
import {
  accentFor,
  carrierTitle,
  compareWinner,
  deliveryRate,
  isProvisional,
  lateTone,
  rateStatus,
  rateTrend,
  reasonGroup,
  reasonsView,
  returnsView,
  share,
  sharedCities,
  trimLeadingEmptyWeeks,
  weekRows,
} from "./view-model";
import type { ScorecardCarrier, ScorecardPeriod, ScorecardReturns } from "./types";

const period = (over: Partial<ScorecardPeriod> = {}): ScorecardPeriod => ({
  sent: 0, delivered: 0, failed: 0, in_flight: 0, prev_delivered: 0, prev_failed: 0,
  picked: 0, picked_fast: 0, first_attempt: null, median_days: null, fast3: 0, ...over,
});

const returns = (over: Partial<ScorecardReturns> = {}): ScorecardReturns => ({
  failed: 0, handed_back: 0, scanned: 0, out: 0, out_late: 0, age_lt7: 0, age_7_30: 0, age_30p: 0,
  within7: 0, median_days: null, ...over,
});

const carrier = (over: Partial<ScorecardCarrier> = {}): ScorecardCarrier => ({
  id: "c1", name: "Darb Assabil - Tripoli", code: "darb_assabil", accent_color: "#1F5FBF",
  account_label: { fr: "Tripoli", ar: "طرابلس" }, first_upload_at: null, last_upload_at: null,
  has_reasons: true, has_attempts: true, period: period(), weeks: [],
  open: { total: 0, not_picked: 0, b0_2: 0, b3_4: 0, b5_9: 0, b10p: 0, late: 0, stuck: 0 },
  returns: returns(), reasons: [], cities: [], ...over,
});

describe("deliveryRate", () => {
  it("is delivered ÷ (delivered + failed), parcels still on the road left out", () => {
    expect(deliveryRate(178, 172)).toBeCloseTo(50.857, 2);
  });
  it("is null with nothing finished", () => {
    expect(deliveryRate(0, 0)).toBeNull();
  });
});

describe("isProvisional", () => {
  it("flags a period with more than 10 % of its parcels still on the road", () => {
    expect(isProvisional(70, 12)).toBe(true);
    expect(isProvisional(370, 19)).toBe(false);
    expect(isProvisional(100, 10)).toBe(false);
  });
  it("is false with nothing sent", () => {
    expect(isProvisional(0, 0)).toBe(false);
  });
});

describe("rateStatus", () => {
  it("compares with the target, near = within 5 points under it", () => {
    expect(rateStatus(62, false, 60)).toBe("ok");
    expect(rateStatus(60, false, 60)).toBe("ok");
    expect(rateStatus(56, false, 60)).toBe("near");
    expect(rateStatus(55, false, 60)).toBe("near");
    expect(rateStatus(54.9, false, 60)).toBe("below");
  });
  it("never judges a provisional or empty rate", () => {
    expect(rateStatus(80, true, 60)).toBe("prov");
    expect(rateStatus(null, false, 60)).toBe("prov");
  });
});

describe("rateTrend", () => {
  it("compares with the period before, in points", () => {
    expect(rateTrend(period({ delivered: 60, failed: 40, prev_delivered: 50, prev_failed: 50 }))).toEqual({ kind: "up", points: 10 });
    expect(rateTrend(period({ delivered: 40, failed: 60, prev_delivered: 50, prev_failed: 50 }))).toEqual({ kind: "down", points: 10 });
  });
  it("calls a move under one point stable", () => {
    expect(rateTrend(period({ delivered: 505, failed: 495, prev_delivered: 50, prev_failed: 50 }))?.kind).toBe("flat");
  });
  it("has no trend when the period before is too thin (a new account) or this one is provisional", () => {
    expect(rateTrend(period({ delivered: 113, failed: 101, prev_delivered: 3, prev_failed: 2 }))).toBeNull();
    expect(rateTrend(period({ sent: 70, delivered: 36, failed: 22, in_flight: 12, prev_delivered: 50, prev_failed: 50 }))).toBeNull();
  });
});

describe("lateTone", () => {
  it("is bad as soon as one parcel is stuck, warn when only late", () => {
    expect(lateTone({ late: 11, stuck: 3 })).toBe("bad");
    expect(lateTone({ late: 4, stuck: 0 })).toBe("warn");
    expect(lateTone({ late: 0, stuck: 0 })).toBe("ok");
  });
});

describe("returnsView", () => {
  it("counts what waits to be scanned, and how much of it is older than 7 days", () => {
    const v = returnsView(returns({ age_lt7: 52, age_7_30: 114, age_30p: 278 }));
    expect(v.unscanned).toBe(444);
    expect(v.olderThan7).toBe(392);
    expect(v.tone).toBe("bad");
  });
  it("is warn for a small old backlog, ok when nothing waits a week", () => {
    expect(returnsView(returns({ age_lt7: 30, age_7_30: 12, age_30p: 3 })).tone).toBe("warn");
    expect(returnsView(returns({ age_lt7: 9 })).tone).toBe("ok");
  });
});

describe("reasonGroup", () => {
  it("sorts a courier remark by who caused the failure", () => {
    expect(reasonGroup("no_answer")).toBe("client");
    expect(reasonGroup("customer_cancelled")).toBe("client");
    expect(reasonGroup("wrong_item")).toBe("us");
    expect(reasonGroup("store_cancelled")).toBe("us");
    expect(reasonGroup("other")).toBe("carrier");
    expect(reasonGroup("none")).toBe("carrier");
    expect(reasonGroup("something_new")).toBe("carrier");
  });
});

describe("reasonsView", () => {
  it("totals the groups and keeps the biggest reasons first", () => {
    const v = reasonsView([
      { class: "other", n: 27 },
      { class: "no_answer", n: 116 },
      { class: "wrong_item", n: 11 },
    ]);
    expect(v.total).toBe(154);
    expect(v.groups).toEqual({ client: 116, carrier: 27, us: 11 });
    expect(v.rows.map((r) => r.cls)).toEqual(["no_answer", "other", "wrong_item"]);
  });
});

describe("weekRows", () => {
  it("rates a week only once 5 parcels are finished, and flags it provisional above 10 % on the road", () => {
    const rows = weekRows([
      { week: "2026-09-21", delivered: 41, failed: 36, in_flight: 8 },
      { week: "2026-09-28", delivered: 19, failed: 11, in_flight: 8 },
      { week: "2026-07-06", delivered: 1, failed: 3, in_flight: 19 },
    ]);
    expect(rows[0].rate).toBeCloseTo(53.2, 1);
    expect(rows[0].provisional).toBe(false);
    expect(rows[1].provisional).toBe(true);
    expect(rows[1].sent).toBe(38);
    expect(rows[2].rate).toBeNull();
  });
});

describe("trimLeadingEmptyWeeks", () => {
  it("drops the weeks before an account's first rated week, keeping a minimum", () => {
    const rows = weekRows([
      { week: "a", delivered: 0, failed: 0, in_flight: 0 },
      { week: "b", delivered: 0, failed: 0, in_flight: 0 },
      { week: "c", delivered: 10, failed: 10, in_flight: 0 },
      { week: "d", delivered: 10, failed: 10, in_flight: 0 },
    ]);
    expect(trimLeadingEmptyWeeks(rows, 2).map((r) => r.week)).toEqual(["c", "d"]);
    expect(trimLeadingEmptyWeeks(rows, 3).map((r) => r.week)).toEqual(["b", "c", "d"]);
  });
});

describe("compareWinner", () => {
  it("names the higher share, and calls a gap under 3 points a tie", () => {
    expect(compareWinner(76, 25)).toBe("a");
    expect(compareWinner(35, 40)).toBe("b");
    expect(compareWinner(78, 76)).toBe("tie");
    expect(compareWinner(null, 40)).toBe("b");
    expect(compareWinner(null, null)).toBeNull();
  });
});

describe("share", () => {
  it("is a percentage, or null on an empty base", () => {
    expect(share(3, 5)).toBe(60);
    expect(share(0, 0)).toBeNull();
    expect(share(null, 5)).toBeNull();
  });
});

describe("sharedCities", () => {
  it("keeps the cities both serve with enough finished parcels, biggest first", () => {
    const rows = sharedCities(
      [{ city: "بنغازي", delivered: 48, failed: 31, median_days: 2 }, { city: "سبها", delivered: 38, failed: 26, median_days: 2 },
       { city: "طبرق", delivered: 5, failed: 12, median_days: 4 }, { city: "طرابلس", delivered: 93, failed: 126, median_days: 1 }],
      [{ city: "بنغازي", delivered: 42, failed: 41, median_days: 1 }, { city: "سبها", delivered: 12, failed: 7, median_days: 4 },
       { city: "طبرق", delivered: 4, failed: 3, median_days: 2 }],
      10,
    );
    expect(rows.map((r) => r.city)).toEqual(["بنغازي", "سبها"]);
    expect(rows[0].a.rate).toBeCloseTo(60.76, 1);
    expect(rows[0].b.finished).toBe(83);
  });
});

describe("carrierTitle / accentFor", () => {
  it("titles a multi-account carrier by its city, others by their name", () => {
    expect(carrierTitle(carrier(), "fr")).toBe("Tripoli");
    expect(carrierTitle(carrier(), "ar")).toBe("طرابلس");
    expect(carrierTitle(carrier({ name: "Navex", code: "navex", account_label: null }), "ar")).toBe("Navex");
  });
  it("uses the account colour, else the validated pair by position", () => {
    expect(accentFor(carrier({ accent_color: "#123456" }), 0)).toBe("#123456");
    expect(accentFor(carrier({ accent_color: null }), 0)).toBe("#1F5FBF");
    expect(accentFor(carrier({ accent_color: null }), 1)).toBe("#C24E17");
  });
});
