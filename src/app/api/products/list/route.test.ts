import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();
const mockLoadMetrics = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: () => mockGetActor() }));
vi.mock("@/lib/products/metrics", () => ({
  loadProductPeriodMetrics: (...args: unknown[]) => mockLoadMetrics(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import type { ProductPeriodMetrics } from "@/types/product-list";

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

/**
 * Twelve products spanning every facet.
 *
 * Twelve, not eight, because the only legal page sizes are 10/25/50/100 — with a
 * smaller catalogue there is no second page to test and the pagination
 * assertions would be vacuous.
 *
 * The two low-stock rows are named YANKEE and ZULU on purpose: sorted by name
 * they fall on page 2, so `filter=lowStock` pulling them onto page 1 proves the
 * filter runs over the whole catalogue rather than the visible rows. That is the
 * headline defect this endpoint exists to fix.
 */
const VIEW_ROWS = [
  { id: "a", name: "Alpha", current_stock: 100, low_stock_threshold: 10, is_active: true },
  { id: "b", name: "Bravo", current_stock: 90, low_stock_threshold: 5, is_active: true },
  { id: "c", name: "Charlie", current_stock: 80, low_stock_threshold: 5, is_active: true },
  { id: "d", name: "Delta", current_stock: 70, low_stock_threshold: 5, is_active: true },
  { id: "e", name: "Echo", current_stock: 60, low_stock_threshold: 5, is_active: false },
  { id: "f", name: "Foxtrot", current_stock: 55, low_stock_threshold: 5, is_active: true },
  { id: "g", name: "Golf", current_stock: 50, low_stock_threshold: 5, is_active: true },
  { id: "h", name: "Hotel", current_stock: 45, low_stock_threshold: 5, is_active: true },
  { id: "i", name: "India", current_stock: 40, low_stock_threshold: 5, is_active: true },
  { id: "j", name: "Juliett", current_stock: 35, low_stock_threshold: 5, is_active: true },
  // page 2 when sorted by name
  { id: "y", name: "Yankee", current_stock: 0, low_stock_threshold: 5, is_active: true },
  { id: "z", name: "Zulu", current_stock: 4, low_stock_threshold: 5, is_active: true },
].map((r) => ({
  market_id: "m-ly",
  sku: `SKU-${r.id}`,
  image_url: null,
  unit_cogs: 10,
  packing_cost: 1,
  confirmation_processing_cost: 0.5,
  default_price: 50,
  initial_stock: r.current_stock,
  system_inventory: r.current_stock,
  real_inventory: r.current_stock,
  damaged_return_count: 0,
  product_variants: [{ count: 0 }],
  ...r,
}));

const METRIC_MAP = new Map<string, ProductPeriodMetrics>([
  ["a", metrics({ revenue: 5000, net_profit: 900, margin_pct: 18 })], // top earner
  ["b", metrics({ revenue: 400, net_profit: -80, margin_pct: -20 })], // losingMoney + worst margin
  ["c", metrics({ revenue: 900, net_profit: 45, margin_pct: 5 })], // thinMargin
  ["d", metrics({ revenue: 0, net_profit: 0, margin_pct: 0, total_leads: 0 })], // noSales
  ["e", metrics({ revenue: 700, net_profit: 140, margin_pct: 20 })], // inactive
  ["f", metrics({ revenue: 1200, net_profit: 300, margin_pct: 25 })],
  ["g", metrics({ revenue: 1100, net_profit: 260, margin_pct: 23.6 })],
  ["h", metrics({ revenue: 2200, net_profit: 500, margin_pct: 22.7 })],
  ["i", metrics({ revenue: 1500, net_profit: 330, margin_pct: 22 })],
  ["j", metrics({ revenue: 800, net_profit: 170, margin_pct: 21.3 })],
  ["y", metrics({ revenue: 650, net_profit: 130, margin_pct: 20 })], // outOfStock + lowStock
  ["z", metrics({ revenue: 620, net_profit: 120, margin_pct: 19.4 })], // lowStock only
]);

const CATALOGUE_SIZE = VIEW_ROWS.length;

function viewChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  const pass = () => c;
  for (const m of ["select", "eq", "order", "ilike", "in"]) {
    c[m] = vi.fn().mockImplementation(pass);
  }
  // fetchAllRows drives the catalogue read with .range()
  c.range = vi.fn().mockImplementation((f: number) =>
    Promise.resolve({ data: f === 0 ? rows : [], error: null }),
  );
  return c;
}

function marketChain(currency: string) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: { currency }, error: null });
  return c;
}

function wire(rows: unknown[] = VIEW_ROWS, currency = "LYD") {
  mockFrom.mockImplementation((table: string) => {
    if (table === "markets") return marketChain(currency);
    return viewChain(rows);
  });
}

function req(qs = "") {
  const url = new URL(`http://localhost/api/products/list${qs ? `?${qs}` : ""}`);
  return new NextRequest(url);
}

beforeEach(() => {
  mockGetActor.mockReset();
  mockFrom.mockReset();
  mockLoadMetrics.mockReset();
  mockLoadMetrics.mockResolvedValue(METRIC_MAP);
});

describe("GET /api/products/list — authorization", () => {
  test("401 when unauthenticated", async () => {
    const { NextResponse } = await import("next/server");
    mockGetActor.mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET(req("market_id=m-ly"))).status).toBe(401);
  });

  // Migrated from profitability-bulk/route.test.ts so the matrix is not lost
  // when that route is deleted.
  test.each(["agent", "warehouse_agent", "investor"])("403 for %s", async (role) => {
    mockGetActor.mockResolvedValue({ actor: { id: "u", role, market_id: "m-ly" } });
    expect((await GET(req("market_id=m-ly"))).status).toBe(403);
  });

  test("400 for super_admin without market_id — cross-market ad spend has no allocation", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    expect((await GET(req())).status).toBe(400);
  });

  test("market_manager ignores the market_id param and uses their own market", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "mm", role: "market_manager", market_id: "m-ly" },
    });
    wire();
    const res = await GET(req("market_id=m-tn-ATTACK"));
    expect(res.status).toBe(200);
    const scoped = mockLoadMetrics.mock.calls[0][0] as { products: { id: string }[] };
    expect(scoped.products.length).toBe(VIEW_ROWS.length);
  });
});

describe("GET /api/products/list — counts must not lie", () => {
  const FACETS = [
    "all",
    "active",
    "inactive",
    "outOfStock",
    "lowStock",
    "losingMoney",
    "thinMargin",
    "noSales",
  ] as const;

  test.each(FACETS)(
    "facets.%s equals pagination.total when that filter is applied",
    async (facet) => {
      mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
      wire();
      const res = await GET(req(`market_id=m-ly&filter=${facet}&limit=100`));
      const json = await res.json();
      expect(json.facets[facet]).toBe(json.pagination.total);
    },
  );

  test("the tile count also matches from page 3 of an unfiltered list", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req("market_id=m-ly&limit=10&page=3&filter=lowStock"));
    const json = await res.json();
    expect(json.facets.lowStock).toBe(json.pagination.total);
  });
});

describe("GET /api/products/list — whole-catalogue filter and sort", () => {
  // The headline defect: filters used to run client-side over the current page,
  // so a low-stock product on page 2 was invisible from page 1.
  test("filter=lowStock finds rows that fall outside the first unfiltered page", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();

    // Establish the premise: Yankee and Zulu are NOT on unfiltered page 1.
    const unfiltered = await (await GET(req("market_id=m-ly&filter=all&limit=10&page=1"))).json();
    const page1 = unfiltered.data.map((r: { id: string }) => r.id);
    expect(page1).not.toContain("y");
    expect(page1).not.toContain("z");

    // Filtering still finds them, from page 1.
    const res = await GET(req("market_id=m-ly&filter=lowStock&limit=10&page=1"));
    const json = await res.json();
    const ids = json.data.map((r: { id: string }) => r.id);
    expect(ids.sort()).toEqual(["y", "z"]);
    expect(json.pagination.total).toBe(2);
  });

  test("sort=margin_pct&dir=asc surfaces the worst margin first, across the whole catalogue", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req("market_id=m-ly&sort=margin_pct&dir=asc&limit=10"));
    const json = await res.json();
    expect(json.data[0].id).toBe("b"); // margin -20
  });

  test("sort=revenue&dir=desc surfaces the top earner first", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req("market_id=m-ly&sort=revenue&dir=desc&limit=10"));
    const json = await res.json();
    expect(json.data[0].id).toBe("a"); // revenue 5000
  });

  test("an unsupported limit falls back to the default page size", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const json = await (await GET(req("market_id=m-ly&limit=3"))).json();
    expect(json.pagination.limit).toBe(25);
  });

  test("q is escaped before reaching ilike", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    const ilike = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "markets") return marketChain("LYD");
      const c = viewChain(VIEW_ROWS) as Record<string, unknown>;
      c.ilike = vi.fn().mockImplementation((...a: unknown[]) => {
        ilike(...a);
        return c;
      });
      return c;
    });
    await GET(req("market_id=m-ly&q=cr%C3%A8me_50%25"));
    expect(ilike).toHaveBeenCalledWith("name", "%crème\\_50\\%%");
  });
});

describe("GET /api/products/list — pagination integrity", () => {
  test("page beyond totalPages clamps, and the response reports the clamped page", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req("market_id=m-ly&filter=inactive&page=7&limit=25"));
    const json = await res.json();
    // 1 inactive row → 1 page. Reporting page 7 would render "showing 151–175 of 1".
    expect(json.pagination.page).toBe(1);
    expect(json.pagination.totalPages).toBe(1);
    expect(json.data).toHaveLength(1);
  });

  test("rangeFrom/rangeTo agree with data length and total on a later page", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req("market_id=m-ly&filter=all&limit=10&page=2"));
    const json = await res.json();
    // The old page computed these from the post-client-filter length against a
    // server total, so they could contradict each other by construction.
    expect(json.pagination.rangeFrom).toBe(11);
    expect(json.pagination.rangeTo).toBe(CATALOGUE_SIZE);
    expect(json.pagination.rangeTo - json.pagination.rangeFrom + 1).toBe(json.data.length);
    expect(json.pagination.total).toBe(CATALOGUE_SIZE);
    expect(json.pagination.totalPages).toBe(2);
  });

  test("an empty result reports range 0–0, not 1–0", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire([]);
    mockLoadMetrics.mockResolvedValue(new Map());
    const res = await GET(req("market_id=m-ly"));
    const json = await res.json();
    expect(json.pagination.total).toBe(0);
    expect(json.pagination.rangeFrom).toBe(0);
    expect(json.pagination.rangeTo).toBe(0);
    expect(json.pagination.totalPages).toBe(1);
  });

  test("no row is repeated or skipped when every metric ties", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    // All revenues equal → ties are the common case; a non-total order would
    // let .slice() repeat a page-1 row on page 2.
    const tied = new Map(
      [...METRIC_MAP.keys()].map((k) => [k, metrics({ revenue: 0, net_profit: 0, margin_pct: 0 })]),
    );
    mockLoadMetrics.mockResolvedValue(tied);

    const seen: string[] = [];
    for (const page of [1, 2]) {
      const res = await GET(req(`market_id=m-ly&filter=all&sort=revenue&dir=desc&limit=10&page=${page}`));
      const json = await res.json();
      seen.push(...json.data.map((r: { id: string }) => r.id));
    }
    expect(seen).toHaveLength(CATALOGUE_SIZE);
    expect(new Set(seen).size).toBe(CATALOGUE_SIZE);
  });
});

describe("GET /api/products/list — payload", () => {
  test("period defaults to the last 30 days and is echoed back", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req("market_id=m-ly"));
    const json = await res.json();
    expect(json.period.from_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(json.period.to_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const called = mockLoadMetrics.mock.calls[0][0] as { fromDate: string; toDate: string };
    expect(called.fromDate).toBe(json.period.from_date);
    expect(called.toDate).toBe(json.period.to_date);
    const days =
      (Date.parse(json.period.to_date) - Date.parse(json.period.from_date)) / 86_400_000;
    expect(days).toBeGreaterThanOrEqual(29);
    expect(days).toBeLessThanOrEqual(30);
  });

  test("currency comes from markets.currency, not a hardcoded ternary", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire(VIEW_ROWS, "LYD");
    const json = await (await GET(req("market_id=m-ly"))).json();
    expect(json.currency).toBe("LYD");
  });

  test("rows nest period figures under metrics and carry variant_count", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const json = await (await GET(req("market_id=m-ly&sort=name&dir=asc&limit=1"))).json();
    const row = json.data[0];
    expect(row.id).toBe("a");
    expect(row.metrics.revenue).toBe(5000);
    expect(row.variant_count).toBe(0);
    expect(row).not.toHaveProperty("product_variants");
    expect(row.unit_cogs).toBe(10);
    expect(row.is_active).toBe(true);
  });

  test("totals are market-wide and independent of the active filter", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const unfiltered = await (await GET(req("market_id=m-ly"))).json();
    const filtered = await (await GET(req("market_id=m-ly&filter=inactive"))).json();
    // A KPI that moved when you clicked a filter would not be trustworthy.
    expect(filtered.totals.revenue).toBe(unfiltered.totals.revenue);
    expect(filtered.totals.stock_value).toBe(unfiltered.totals.stock_value);
  });

  test("stock split segments are mutually exclusive and sum to the catalogue", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const json = await (await GET(req("market_id=m-ly"))).json();
    const t = json.totals;
    // Yankee is BOTH outOfStock and lowStock as a facet, but must be counted
    // once here or the stacked bar over-fills.
    expect(t.out_of_stock_count).toBe(1); // Yankee
    expect(t.low_only_count).toBe(1); // Zulu
    expect(t.healthy_count).toBe(CATALOGUE_SIZE - 2);
    expect(t.healthy_count + t.low_only_count + t.out_of_stock_count).toBe(CATALOGUE_SIZE);
    // Whereas the FACETS legitimately overlap.
    expect(json.facets.outOfStock).toBe(1);
    expect(json.facets.lowStock).toBe(2);
  });

  test("highlights are computed over the whole catalogue", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const json = await (await GET(req("market_id=m-ly&limit=1"))).json();
    // Would be wrong if derived from the single returned row.
    expect(json.highlights.top_earner.id).toBe("a");
    expect(json.highlights.worst_margin.id).toBe("b");
  });

  // Perf regression fence. This route used to load the previous window too, in
  // parallel, purely to produce two KPI delta percentages. Measured on Libya the
  // previous window transports ~4,666 rows against the current window's ~611,
  // and two of its fetches cross fetchAllRows' 1000-row page boundary and so
  // serialise. It now lives in ./previous, off the critical path.
  test("loads metrics for the CURRENT window only — never a second window", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    await GET(req("market_id=m-ly&from_date=2026-07-10&to_date=2026-08-08"));

    expect(mockLoadMetrics).toHaveBeenCalledTimes(1);
    const arg = mockLoadMetrics.mock.calls[0][0] as { fromDate: string; toDate: string };
    expect(arg.fromDate).toBe("2026-07-10");
    expect(arg.toDate).toBe("2026-08-08");
  });

  test("previous-period totals are null — filled in by the separate endpoint", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const json = await (await GET(req("market_id=m-ly"))).json();
    // null, not 0: a zero baseline and an unloaded baseline must stay
    // distinguishable, or the delta pill renders "+100 %" out of nothing.
    expect(json.totals.previous_revenue).toBeNull();
    expect(json.totals.previous_net_profit).toBeNull();
  });

  test("sets a private Cache-Control header", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const res = await GET(req("market_id=m-ly"));
    expect(res.headers.get("Cache-Control")).toContain("private");
  });
});

/**
 * La facette d'ouverture est passée de « all » à « active ». C'est le seul
 * endroit où l'absence de paramètre change de sens, donc le seul endroit où un
 * appelant existant peut être surpris : on le verrouille.
 */
describe("GET /api/products/list — facette par défaut", () => {
  test("sans paramètre filter, les produits désactivés sont exclus", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const json = await (await GET(req("market_id=m-ly&limit=50"))).json();
    const ids = json.data.map((r: { id: string }) => r.id);
    expect(ids).not.toContain("e");
    expect(json.pagination.total).toBe(CATALOGUE_SIZE - 1);
  });

  test("filter=all rend le catalogue entier, désactivés compris", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const json = await (await GET(req("market_id=m-ly&filter=all&limit=50"))).json();
    expect(json.data.map((r: { id: string }) => r.id)).toContain("e");
    expect(json.pagination.total).toBe(CATALOGUE_SIZE);
  });

  // Les compteurs de facettes portent TOUT le catalogue, sinon la pastille
  // « Inactifs » afficherait zéro depuis la vue par défaut.
  test("les compteurs de facettes restent calculés sur le catalogue entier", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
    wire();
    const json = await (await GET(req("market_id=m-ly&limit=50"))).json();
    expect(json.facets.all).toBe(CATALOGUE_SIZE);
    expect(json.facets.inactive).toBe(1);
  });
});
