import { describe, it, expect } from "vitest";
import {
  versionInForce,
  resolveMapping,
  splitInteger,
  autoWeights,
  allocateFact,
  projectAdSpend,
  withDraft,
  type MappingVersion,
  type AdsetDayFact,
  type OrderCounts,
} from "../allocation";

/**
 * The rules that decide which product's P&L — and which investor's share —
 * absorbs a dinar of Meta spend. Every figure a remap moves passes through
 * here, so the precedence, the effective dating and the rounding are pinned
 * one by one.
 */

const v = (over: Partial<MappingVersion>): MappingVersion => ({
  id: over.id ?? "v",
  external_campaign_id: "C1",
  external_adset_id: null,
  effective_from: null,
  kind: "products",
  split_mode: null,
  lines: [{ product_id: "L", share_pct: null }],
  ...over,
});

const fact = (over: Partial<AdsetDayFact> = {}): AdsetDayFact => ({
  ad_account_id: "act1",
  market_id: "ly",
  external_campaign_id: "C1",
  external_adset_id: "S1",
  campaign_name: "BoxLyLong - relaunch",
  adset_name: "BoxLyLong relaunch",
  day: "2026-08-11",
  amount: 100,
  spend_original: 11.9048,
  currency_original: "USD",
  fx_rate: 8.4,
  impressions: 1000,
  reach: 800,
  clicks: 30,
  frequency: 1.25,
  platform_results: 9,
  ...over,
});

const counts = (entries: [string, Record<string, number>][]): OrderCounts =>
  new Map(entries.map(([day, byProduct]) => [day, new Map(Object.entries(byProduct))]));

describe("versionInForce — effective dating", () => {
  const versions = [
    v({ id: "since-start", effective_from: null }),
    v({ id: "from-aug", effective_from: "2026-08-01" }),
    v({ id: "from-sep", effective_from: "2026-09-01" }),
  ];

  it("a version with no start date governs everything before the first dated one", () => {
    expect(versionInForce(versions, "C1", null, "2026-07-06")?.id).toBe("since-start");
  });

  it("a dated version starts ON its date, not the day after", () => {
    expect(versionInForce(versions, "C1", null, "2026-08-01")?.id).toBe("from-aug");
    expect(versionInForce(versions, "C1", null, "2026-08-31")?.id).toBe("from-aug");
    expect(versionInForce(versions, "C1", null, "2026-09-01")?.id).toBe("from-sep");
  });

  it("nothing is in force before a first version that is itself dated", () => {
    expect(versionInForce([v({ effective_from: "2026-08-01" })], "C1", null, "2026-07-31")).toBeNull();
  });

  it("never lets another campaign's or another ad set's version answer", () => {
    expect(versionInForce(versions, "C2", null, "2026-08-11")).toBeNull();
    expect(versionInForce(versions, "C1", "S1", "2026-08-11")).toBeNull();
  });
});

describe("resolveMapping — an ad set follows its campaign unless it says otherwise", () => {
  const campaign = v({ id: "camp", lines: [{ product_id: "Q", share_pct: null }] });

  it("follows the campaign when the ad set has nothing of its own", () => {
    expect(resolveMapping([campaign], "C1", "S1", "2026-09-10")?.id).toBe("camp");
  });

  it("its own version wins over the campaign's", () => {
    const own = v({ id: "own", external_adset_id: "S1", lines: [{ product_id: "T", share_pct: null }] });
    expect(resolveMapping([campaign, own], "C1", "S1", "2026-09-10")?.id).toBe("own");
    expect(resolveMapping([campaign, own], "C1", "S2", "2026-09-10")?.id).toBe("camp");
  });

  it("an 'inherit' version hands the ad set back to its campaign from its date", () => {
    const own = v({ id: "own", external_adset_id: "S1" });
    const back = v({ id: "back", external_adset_id: "S1", kind: "inherit", lines: [], effective_from: "2026-09-01" });
    expect(resolveMapping([campaign, own, back], "C1", "S1", "2026-08-31")?.id).toBe("own");
    expect(resolveMapping([campaign, own, back], "C1", "S1", "2026-09-01")?.id).toBe("camp");
  });

  it("an ad set's own version that starts later leaves earlier days to the campaign", () => {
    const own = v({ id: "own", external_adset_id: "S1", effective_from: "2026-09-08" });
    expect(resolveMapping([campaign, own], "C1", "S1", "2026-09-07")?.id).toBe("camp");
    expect(resolveMapping([campaign, own], "C1", "S1", "2026-09-08")?.id).toBe("own");
  });

  it("returns null when nobody has decided anything", () => {
    expect(resolveMapping([], "C1", "S1", "2026-09-10")).toBeNull();
  });
});

describe("splitInteger — largest remainder, exact by construction", () => {
  it("always adds back up to the total", () => {
    const parts = splitInteger(100_001, [606, 238, 150]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_001);
  });

  it("gives the leftover units to the largest remainders", () => {
    // 10 / 3 = 3.33 each → 3,3,3 and one unit left, to the first of the ties
    expect(splitInteger(10, [1, 1, 1])).toEqual([4, 3, 3]);
    // 100 × [2,1] = 66.67 / 33.33 → the .67 gets the unit
    expect(splitInteger(100, [2, 1])).toEqual([67, 33]);
  });

  it("splits equally when every weight is zero, rather than losing the money", () => {
    expect(splitInteger(9, [0, 0, 0])).toEqual([3, 3, 3]);
  });

  it("a zero weight gets nothing when others are positive", () => {
    expect(splitInteger(50, [0, 1])).toEqual([0, 50]);
  });

  it("handles a zero total", () => {
    expect(splitInteger(0, [3, 1])).toEqual([0, 0]);
  });
});

describe("autoWeights — the day's orders, then the week before, then equal", () => {
  it("uses that day's orders when there are any", () => {
    const c = counts([["2026-08-11", { M: 84, S: 52, L: 17 }]]);
    expect(autoWeights(["M", "S", "L"], "2026-08-11", c)).toEqual({ weights: [84, 52, 17], basis: "auto_orders" });
  });

  it("falls back to the 7 days before when the day had no order for any of them", () => {
    const c = counts([
      ["2026-08-02", { M: 1 }], // 8 days before: outside the window
      ["2026-08-03", { M: 10, S: 5 }],
      ["2026-08-09", { L: 5 }],
    ]);
    expect(autoWeights(["M", "S", "L"], "2026-08-10", c)).toEqual({
      weights: [10, 5, 5],
      basis: "auto_trailing_7d",
    });
  });

  it("does not count the day itself in the trailing window", () => {
    const c = counts([["2026-08-10", { M: 0 }], ["2026-08-09", { S: 2 }]]);
    expect(autoWeights(["M", "S"], "2026-08-10", c).weights).toEqual([0, 2]);
  });

  it("splits equally when eight days produced nothing at all", () => {
    expect(autoWeights(["M", "S"], "2026-08-10", counts([]))).toEqual({
      weights: [1, 1],
      basis: "auto_equal",
    });
  });
});

describe("allocateFact — one ad set-day becomes one row per product share", () => {
  it("writes one unattributed row when nobody has mapped the campaign", () => {
    const rows = allocateFact(fact(), null, counts([]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ product_id: null, allocation_basis: "unmapped", amount: 100, mapping_id: null });
  });

  it("writes one market-level row for a deliberate 'no product' decision", () => {
    const rows = allocateFact(fact(), v({ id: "mk", kind: "market_level", lines: [] }), counts([]));
    expect(rows).toEqual([expect.objectContaining({ product_id: null, allocation_basis: "market_level", mapping_id: "mk" })]);
  });

  it("carries the whole day, reach included, to a single product", () => {
    const [row] = allocateFact(fact(), v({ id: "one" }), counts([]));
    expect(row).toMatchObject({
      product_id: "L",
      amount: 100,
      amount_original: 11.9048,
      reach: 800,
      frequency: 1.25,
      allocation_share: 1,
      allocation_basis: "single",
      mapping_id: "one",
      period_start: "2026-08-11",
      external_adset_id: "S1",
      adset_name: "BoxLyLong relaunch",
    });
  });

  it("splits by that day's orders, to the millime, and the parts add back up", () => {
    const version = v({
      split_mode: "auto_orders",
      lines: [
        { product_id: "M", share_pct: null },
        { product_id: "S", share_pct: null },
        { product_id: "L", share_pct: null },
      ],
    });
    const rows = allocateFact(fact({ amount: 433.938 }), version, counts([["2026-08-11", { M: 84, S: 52, L: 17 }]]));
    expect(rows.map((r) => r.product_id)).toEqual(["M", "S", "L"]);
    expect(rows.reduce((s, r) => s + Math.round(r.amount * 1000), 0)).toBe(433_938);
    // Within one millime of the exact share: the leftover millime goes to a part.
    expect(Math.abs(rows[0].amount - (433.938 * 84) / 153)).toBeLessThanOrEqual(0.001);
    expect(rows.every((r) => r.allocation_basis === "auto_orders")).toBe(true);
    expect(rows.reduce((s, r) => s + r.allocation_share, 0)).toBeCloseTo(1, 8);
  });

  it("splits the counters too, as integers that add back up", () => {
    const version = v({
      split_mode: "manual",
      lines: [
        { product_id: "M", share_pct: 60 },
        { product_id: "S", share_pct: 25 },
        { product_id: "L", share_pct: 15 },
      ],
    });
    const rows = allocateFact(fact({ impressions: 1001, clicks: 7, platform_results: 9 }), version, counts([]));
    expect(rows.map((r) => r.impressions)).toEqual([601, 250, 150]);
    expect(rows.reduce((s, r) => s + (r.clicks ?? 0), 0)).toBe(7);
    expect(rows.reduce((s, r) => s + (r.platform_results ?? 0), 0)).toBe(9);
    expect(rows.every((r) => r.allocation_basis === "manual")).toBe(true);
  });

  it("leaves reach and frequency empty on a split row — people are not divisible", () => {
    const version = v({
      split_mode: "manual",
      lines: [
        { product_id: "M", share_pct: 50 },
        { product_id: "S", share_pct: 50 },
      ],
    });
    const rows = allocateFact(fact(), version, counts([]));
    expect(rows.every((r) => r.reach === null && r.frequency === null)).toBe(true);
  });

  it("keeps a counter null when Meta reported nothing, instead of inventing zeros", () => {
    const [row] = allocateFact(fact({ platform_results: null }), v({}), counts([]));
    expect(row.platform_results).toBeNull();
  });

  it("an 'inherit' version never reaches allocation as a decision of its own", () => {
    const rows = allocateFact(fact(), v({ kind: "inherit", external_adset_id: "S1", lines: [] }), counts([]));
    expect(rows[0].allocation_basis).toBe("unmapped");
  });
});

describe("projectAdSpend — the whole projection", () => {
  it("resolves each fact on its own day, so a dated remap splits history at its date", () => {
    const versions = [
      v({ id: "old", lines: [{ product_id: "L", share_pct: null }] }),
      v({ id: "new", effective_from: "2026-08-01", lines: [{ product_id: "M", share_pct: null }] }),
    ];
    const rows = projectAdSpend(
      [fact({ day: "2026-07-31" }), fact({ day: "2026-08-01" })],
      versions,
      counts([]),
    );
    expect(rows.map((r) => [r.period_start, r.product_id])).toEqual([
      ["2026-07-31", "L"],
      ["2026-08-01", "M"],
    ]);
  });

  it("skips a day on which nothing was spent", () => {
    expect(projectAdSpend([fact({ amount: 0, spend_original: 0 })], [v({})], counts([]))).toEqual([]);
  });
});

describe("withDraft — what the RPC will do, applied in memory for a preview", () => {
  const live = [
    v({ id: "a", effective_from: null }),
    v({ id: "b", effective_from: "2026-08-01" }),
    v({ id: "other", external_campaign_id: "C2" }),
  ];

  it("'all history' replaces every version of the target, and nothing else", () => {
    const next = withDraft(live, { external_campaign_id: "C1", external_adset_id: null, effective_from: null, kind: "market_level", split_mode: null, lines: [] });
    expect(next.map((x) => x.id).sort()).toEqual(["draft", "other"]);
  });

  it("'from D' replaces versions starting on or after D and keeps the older one", () => {
    const next = withDraft(live, { external_campaign_id: "C1", external_adset_id: null, effective_from: "2026-08-01", kind: "products", split_mode: null, lines: [{ product_id: "M", share_pct: null }] });
    expect(next.map((x) => x.id).sort()).toEqual(["a", "draft", "other"]);
  });

  it("an ad set's draft never touches its campaign's versions", () => {
    const next = withDraft(live, { external_campaign_id: "C1", external_adset_id: "S1", effective_from: null, kind: "products", split_mode: null, lines: [{ product_id: "M", share_pct: null }] });
    expect(next).toHaveLength(4);
  });
});
