import { describe, test, expect } from "vitest";
import {
  predicateForFacet,
  applyFacet,
  computeFacetCounts,
  comparatorFor,
  parseProductListQuery,
  productListQueryToParams,
  computeHighlights,
  computeStockSplit,
} from "../list-filters";
import {
  PRODUCT_FACETS,
  type ProductListRow,
  type ProductPeriodMetrics,
} from "@/types/product-list";

function metrics(over: Partial<ProductPeriodMetrics> = {}): ProductPeriodMetrics {
  return {
    total_leads: 10,
    confirmed_count: 6,
    dispatched_count: 6,
    delivered_count: 5,
    returned_count: 1,
    confirmation_rate: 60,
    delivery_rate: 83.3,
    return_rate: 16.7,
    revenue: 1000,
    net_profit: 200,
    margin_pct: 20,
    cost_per_delivered: 160,
    // Cost lines sum to 800, so revenue - costs === net_profit. Keeping the
    // fixture internally consistent means a test can rely on that invariant.
    cogs: 500,
    delivery_cost: 120,
    return_cost: 30,
    packing_cost: 60,
    processing_cost: 40,
    ad_spend: 50,
    ...over,
  };
}

function row(over: Partial<ProductListRow> = {}): ProductListRow {
  return {
    id: "p-1",
    market_id: "m-1",
    name: "Alpha",
    sku: "A-1",
    image_url: null,
    unit_cogs: 10,
    packing_cost: 1,
    confirmation_processing_cost: 0.5,
    default_price: 50,
    initial_stock: 100,
    current_stock: 100,
    system_inventory: 100,
    real_inventory: 95,
    low_stock_threshold: 10,
    damaged_return_count: 0,
    is_active: true,
    variant_count: 0,
    metrics: metrics(),
    ...over,
  };
}

/** Seven rows covering every facet, incl. one that is BOTH out-of-stock and low. */
const FIXTURE: ProductListRow[] = [
  row({ id: "a", name: "Alpha", current_stock: 100, low_stock_threshold: 10 }),
  // out-of-stock AND low-stock at once — the facets overlap by definition
  row({ id: "b", name: "Bravo", current_stock: 0, low_stock_threshold: 5 }),
  // low but not out
  row({ id: "c", name: "Charlie", current_stock: 4, low_stock_threshold: 5 }),
  // threshold 0 disables the low-stock rule entirely
  row({ id: "d", name: "Delta", current_stock: 0, low_stock_threshold: 0 }),
  row({ id: "e", name: "Echo", is_active: false }),
  row({ id: "f", name: "Foxtrot", metrics: metrics({ net_profit: -30, margin_pct: -3 }) }),
  row({ id: "g", name: "Golf", metrics: metrics({ margin_pct: 7 }) }),
  row({ id: "h", name: "Hotel", metrics: metrics({ total_leads: 0, revenue: 0, net_profit: 0, margin_pct: 0 }) }),
];

describe("predicateForFacet", () => {
  test("all matches everything", () => {
    expect(applyFacet(FIXTURE, "all")).toHaveLength(FIXTURE.length);
  });

  test("active / inactive partition on is_active", () => {
    expect(applyFacet(FIXTURE, "active").map((r) => r.id)).not.toContain("e");
    expect(applyFacet(FIXTURE, "inactive").map((r) => r.id)).toEqual(["e"]);
  });

  test("outOfStock is stock <= 0, regardless of threshold", () => {
    expect(applyFacet(FIXTURE, "outOfStock").map((r) => r.id).sort()).toEqual(["b", "d"]);
  });

  test("lowStock reuses isLowStock — threshold 0 disables the rule", () => {
    // 'd' has stock 0 but threshold 0, so it is out-of-stock but NOT low-stock.
    expect(applyFacet(FIXTURE, "lowStock").map((r) => r.id).sort()).toEqual(["b", "c"]);
  });

  test("a row can be both outOfStock and lowStock — facets are not a partition", () => {
    const out = applyFacet(FIXTURE, "outOfStock").map((r) => r.id);
    const low = applyFacet(FIXTURE, "lowStock").map((r) => r.id);
    expect(out).toContain("b");
    expect(low).toContain("b");
  });

  test("losingMoney is net_profit < 0, not margin_pct < 0", () => {
    expect(applyFacet(FIXTURE, "losingMoney").map((r) => r.id)).toEqual(["f"]);
  });

  test("thinMargin is a POSITIVE margin at or below the ceiling — excludes losses", () => {
    const ids = applyFacet(FIXTURE, "thinMargin").map((r) => r.id);
    expect(ids).toEqual(["g"]);
    expect(ids).not.toContain("f"); // negative margin has its own facet
    expect(ids).not.toContain("h"); // zero-revenue lands in noSales, not here
  });

  test("noSales is zero leads in the period", () => {
    expect(applyFacet(FIXTURE, "noSales").map((r) => r.id)).toEqual(["h"]);
  });

  test("metric facets never match when metrics are null", () => {
    const blind = FIXTURE.map((r) => ({ ...r, metrics: null }));
    expect(applyFacet(blind, "losingMoney")).toHaveLength(0);
    expect(applyFacet(blind, "thinMargin")).toHaveLength(0);
    expect(applyFacet(blind, "noSales")).toHaveLength(0);
  });

  test("predicateForFacet is the same function applyFacet uses", () => {
    for (const f of PRODUCT_FACETS) {
      expect(FIXTURE.filter(predicateForFacet(f))).toEqual(applyFacet(FIXTURE, f));
    }
  });
});

describe("computeFacetCounts", () => {
  test("exact counts on the fixture", () => {
    expect(computeFacetCounts(FIXTURE)).toEqual({
      all: 8,
      active: 7,
      inactive: 1,
      outOfStock: 2,
      lowStock: 2,
      losingMoney: 1,
      thinMargin: 1,
      noSales: 1,
    });
  });

  // This is the whole point of the module: a tile's number and the row set that
  // tile opens are produced by the same predicate, so they cannot drift.
  test("INVARIANT: every count equals the length of the set its filter opens", () => {
    const counts = computeFacetCounts(FIXTURE);
    for (const f of PRODUCT_FACETS) {
      expect(counts[f]).toBe(applyFacet(FIXTURE, f).length);
    }
  });

  test("metric facet keys are ABSENT, not 0, when metrics are unavailable", () => {
    const blind = FIXTURE.map((r) => ({ ...r, metrics: null }));
    const counts = computeFacetCounts(blind);
    expect(counts).not.toHaveProperty("losingMoney");
    expect(counts).not.toHaveProperty("thinMargin");
    expect(counts).not.toHaveProperty("noSales");
    // Non-metric facets still report.
    expect(counts.outOfStock).toBe(2);
  });

  test("counts of an empty catalogue are all zero, not absent", () => {
    const counts = computeFacetCounts([]);
    expect(counts.all).toBe(0);
    expect(counts.outOfStock).toBe(0);
  });
});

describe("comparatorFor", () => {
  test("sorts by revenue descending", () => {
    const rows = [
      row({ id: "lo", name: "Lo", metrics: metrics({ revenue: 10 }) }),
      row({ id: "hi", name: "Hi", metrics: metrics({ revenue: 900 }) }),
      row({ id: "mid", name: "Mid", metrics: metrics({ revenue: 400 }) }),
    ];
    expect(rows.slice().sort(comparatorFor("revenue", "desc")).map((r) => r.id)).toEqual([
      "hi",
      "mid",
      "lo",
    ]);
  });

  test("name sort is collated, numeric-aware and case-insensitive", () => {
    const rows = [
      row({ id: "2", name: "item 10" }),
      row({ id: "1", name: "Item 2" }),
      row({ id: "3", name: "item 1" }),
    ];
    expect(rows.slice().sort(comparatorFor("name", "asc")).map((r) => r.name)).toEqual([
      "item 1",
      "Item 2",
      "item 10",
    ]);
  });

  test("rows without metrics sort last on a metric key in desc order", () => {
    const rows = [
      row({ id: "none", name: "None", metrics: null }),
      row({ id: "some", name: "Some", metrics: metrics({ revenue: 5 }) }),
    ];
    expect(rows.slice().sort(comparatorFor("revenue", "desc")).map((r) => r.id)).toEqual([
      "some",
      "none",
    ]);
  });

  // With a 30-day window and a small catalogue most revenue values are 0, so
  // ties are the COMMON case, not the edge case.
  test("ties break by name then id, ascending, regardless of direction", () => {
    const tied = [
      row({ id: "z", name: "Same", metrics: metrics({ revenue: 100 }) }),
      row({ id: "a", name: "Same", metrics: metrics({ revenue: 100 }) }),
      row({ id: "m", name: "Same", metrics: metrics({ revenue: 100 }) }),
    ];
    const asc = tied.slice().sort(comparatorFor("revenue", "asc")).map((r) => r.id);
    const desc = tied.slice().sort(comparatorFor("revenue", "desc")).map((r) => r.id);
    expect(asc).toEqual(["a", "m", "z"]);
    expect(desc).toEqual(["a", "m", "z"]);
    // Flipping direction must NOT reshuffle ties, or page boundaries move.
    expect(asc).toEqual(desc);
  });

  test("STABILITY: paginating an all-tied set yields each row exactly once", () => {
    const tied = ["e", "b", "d", "a", "c"].map((id) =>
      row({ id, name: "Identical", metrics: metrics({ revenue: 0 }) }),
    );
    const sorted = tied.slice().sort(comparatorFor("revenue", "desc"));
    const pages = [sorted.slice(0, 2), sorted.slice(2, 4), sorted.slice(4, 6)];
    const seen = pages.flat().map((r) => r.id);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
  });

  test("is_active sorts actives last ascending", () => {
    const rows = [row({ id: "on", is_active: true }), row({ id: "off", is_active: false })];
    expect(rows.slice().sort(comparatorFor("is_active", "asc")).map((r) => r.id)).toEqual([
      "off",
      "on",
    ]);
  });
});

describe("parseProductListQuery", () => {
  function p(qs: string) {
    return parseProductListQuery(new URLSearchParams(qs));
  }

  // La console s'ouvre sur le CATALOGUE VENDABLE, pas sur l'archive. Un produit
  // désactivé n'est plus une décision commerciale en attente : il est rangé.
  test("defaults: active / name / asc / page 1 / limit 25 / last 30 days", () => {
    const q = p("");
    expect(q.filter).toBe("active");
    expect(q.sort).toBe("name");
    expect(q.dir).toBe("asc");
    expect(q.page).toBe(1);
    expect(q.limit).toBe(25);
    expect(q.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.to_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.from_date < q.to_date).toBe(true);
  });

  test("unknown values fall back to defaults rather than throwing", () => {
    const q = p("filter=bogus&sort=bogus&dir=sideways&limit=7&page=0");
    expect(q.filter).toBe("active");
    expect(q.sort).toBe("name");
    expect(q.dir).toBe("asc");
    expect(q.limit).toBe(25);
    expect(q.page).toBe(1);
  });

  test("accepts the documented values", () => {
    const q = p("filter=lowStock&sort=margin_pct&dir=desc&page=3&limit=50&q=%20cream%20");
    expect(q.filter).toBe("lowStock");
    expect(q.sort).toBe("margin_pct");
    expect(q.dir).toBe("desc");
    expect(q.page).toBe(3);
    expect(q.limit).toBe(50);
    expect(q.q).toBe("cream");
  });

  // « Tous » reste atteignable — c'est ainsi qu'on retrouve les désactivés pour
  // les archiver. Ce n'est simplement plus ce qu'on voit en arrivant.
  test("filter=all is still honoured when asked for explicitly", () => {
    expect(p("filter=all").filter).toBe("all");
    expect(p("filter=inactive").filter).toBe("inactive");
  });

  test("explicit dates win over the 30-day default", () => {
    const q = p("from_date=2026-01-01&to_date=2026-01-31");
    expect(q.from_date).toBe("2026-01-01");
    expect(q.to_date).toBe("2026-01-31");
  });

  test("malformed dates are ignored, not passed through to SQL", () => {
    const q = p("from_date=not-a-date&to_date=2026-13-99");
    expect(q.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(q.to_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("productListQueryToParams", () => {
  // Le défaut omis suit le défaut de parse : sinon l'URL porterait « filter=active »
  // en permanence, et « filter=all » se ferait manger au round-trip.
  test("omits filter=active as the default, but keeps filter=all", () => {
    const asActive = productListQueryToParams({ filter: "active" }, { omitDefaults: true });
    expect(asActive.get("filter")).toBeNull();
    const asAll = productListQueryToParams({ filter: "all" }, { omitDefaults: true });
    expect(asAll.get("filter")).toBe("all");
    expect(parseProductListQuery(asAll).filter).toBe("all");
  });

  test("round-trips and omits defaults so shared URLs stay short", () => {
    const q = parseProductListQuery(new URLSearchParams("filter=noSales&sort=revenue&dir=desc&page=2"));
    const params = productListQueryToParams(q, { omitDefaults: true });
    expect(params.get("filter")).toBe("noSales");
    expect(params.get("sort")).toBe("revenue");
    expect(params.get("dir")).toBe("desc");
    expect(params.get("page")).toBe("2");
    expect(params.get("limit")).toBeNull();
    const back = parseProductListQuery(params);
    expect(back.filter).toBe("noSales");
    expect(back.sort).toBe("revenue");
    expect(back.dir).toBe("desc");
    expect(back.page).toBe(2);
  });
});

describe("computeHighlights", () => {
  test("top earner and worst margin come from the whole set", () => {
    const h = computeHighlights(FIXTURE);
    expect(h.top_earner?.id).toBeDefined();
    expect(h.worst_margin?.id).toBe("f");
  });

  test("worst margin ignores zero-revenue rows — a 0 % margin is not a bad margin", () => {
    const rows = [
      row({ id: "zero", metrics: metrics({ revenue: 0, margin_pct: 0, total_leads: 0 }) }),
      row({ id: "thin", metrics: metrics({ revenue: 500, margin_pct: 3 }) }),
    ];
    expect(computeHighlights(rows).worst_margin?.id).toBe("thin");
  });

  test("returns nulls when nothing qualifies", () => {
    expect(computeHighlights([])).toEqual({ top_earner: null, worst_margin: null });
    const blind = FIXTURE.map((r) => ({ ...r, metrics: null }));
    expect(computeHighlights(blind)).toEqual({ top_earner: null, worst_margin: null });
  });
});

describe("computeStockSplit", () => {
  test("healthy / low-only / out are mutually exclusive and sum to the total", () => {
    const s = computeStockSplit(FIXTURE);
    expect(s.out_of_stock_count).toBe(2); // b, d
    expect(s.low_only_count).toBe(1); // c (b is already counted as out)
    expect(s.healthy_count).toBe(FIXTURE.length - 3);
    expect(s.healthy_count + s.low_only_count + s.out_of_stock_count).toBe(FIXTURE.length);
  });
});
