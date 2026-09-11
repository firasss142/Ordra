import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...a: unknown[]) => mockFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

/**
 * Stock, as the phone shows it.
 *
 * The mobile inventory card carries a target, a fourteen-day line and the
 * accuracy of the last physical count. Each of those is real or absent —
 * a product nobody has counted must not read as 100 % correct, and a product
 * with no target must not read as "Goal: 0", which would paint the whole
 * shelf as catastrophically overstocked.
 */

/** One thenable chain standing in for the PostgREST builder. */
function chain(result: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "in", "order", "is", "neq"]) {
    c[m] = vi.fn().mockReturnValue(c);
  }
  c.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return c;
}

interface Wire {
  products?: unknown[];
  orders?: unknown[];
  counts?: unknown[];
  series?: unknown[];
  accuracy?: unknown;
  siteStock?: unknown[];
  warehouses?: unknown[];
  /** The market the signed-in agent belongs to. Defaults to the fake "m-1". */
  actorMarket?: string;
}

function wire({
  products = [], orders = [], counts = [], series = [], accuracy = null,
  siteStock = [], warehouses = [], actorMarket = "m-1",
}: Wire) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return chain({ data: { role: "warehouse_agent", market_id: actorMarket }, error: null });
    if (table === "products") return chain({ data: products, error: null });
    if (table === "orders") return chain({ data: orders, error: null });
    if (table === "inventory_log") return chain({ data: counts, error: null });
    if (table === "product_site_stock") return chain({ data: siteStock, error: null });
    if (table === "warehouses") return chain({ data: warehouses, error: null });
    return chain({ data: [], error: null });
  });
  // getActor reads users via .single(); give the chain one.
  const original = mockFrom.getMockImplementation()!;
  mockFrom.mockImplementation((table: string) => {
    const c = original(table) as Record<string, unknown>;
    c.single = vi.fn().mockResolvedValue({ data: { role: "warehouse_agent", market_id: actorMarket }, error: null });
    c.maybeSingle = c.single;
    return c;
  });
  mockRpc.mockImplementation((fn: string) => {
    if (fn === "get_product_stock_series") return Promise.resolve({ data: series, error: null });
    if (fn === "get_count_accuracy") return Promise.resolve({ data: accuracy, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

const product = (over: Record<string, unknown> = {}) => ({
  id: "p-1",
  name: "دمية الملاكمة حجم كبير",
  sku: "BOX-01",
  image_url: "https://example.test/a.png",
  current_stock: 150,
  low_stock_threshold: 20,
  stock_goal: 200,
  damaged_return_count: 0,
  market_id: "m-1",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
});

const req = () => new NextRequest(new URL("http://localhost/api/warehouse/stock"));

describe("GET /api/warehouse/stock — the fields the phone card needs", () => {
  test("carries the identity a picker reads off the shelf: sku and image", async () => {
    wire({ products: [product()] });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].sku).toBe("BOX-01");
    expect(rows[0].image_url).toBe("https://example.test/a.png");
  });

  test("a product with a target reports it and its progress", async () => {
    wire({ products: [product({ current_stock: 150, stock_goal: 200 })] });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].stock_goal).toBe(200);
    expect(rows[0].goal_pct).toBe(75);
  });

  test("no target means no target — never a goal of zero", async () => {
    // "Goal: 0" would render every untargeted product as 100 % over its aim.
    wire({ products: [product({ stock_goal: null })] });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].stock_goal).toBeNull();
    expect(rows[0].goal_pct).toBeNull();
  });

  test("accuracy comes from the last count, and is null when nobody has counted", async () => {
    wire({
      products: [product(), product({ id: "p-2", name: "كتاب" })],
      accuracy: {
        products: [{ product_id: "p-1", accuracy: 98, last_counted_at: "2026-08-01T10:00:00Z", last_variance: -4 }],
        accuracy: 98,
        counted_products: 1,
        counts: 1,
      },
    });
    const { rows } = await (await GET(req())).json();
    const byId = Object.fromEntries(rows.map((r: { product_id: string }) => [r.product_id, r]));
    expect(byId["p-1"].accuracy).toBe(98);
    // Never counted is not the same fact as counted and correct.
    expect(byId["p-2"].accuracy).toBeNull();
  });

  test("each row carries its own fourteen-day line", async () => {
    wire({
      products: [product()],
      series: [
        { product_id: "p-1", day: "2026-08-22", balance: 160 },
        { product_id: "p-1", day: "2026-08-23", balance: 150 },
      ],
    });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].series).toEqual([160, 150]);
  });

  test("a product with no movement still gets a line rather than a gap", async () => {
    wire({ products: [product()], series: [] });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].series).toEqual([]);
  });
});

describe("GET /api/warehouse/stock — what counts as engaged", () => {
  test("units already scanned out are not engaged: they have left current_stock", async () => {
    // scanned is the stock boundary — scan_order_out already deducted those
    // units. Counting them again against current_stock produced a phantom
    // deficit on the Libyan bench (held 7, "engaged" 11, free −4) for a shelf
    // that was in fact fine.
    wire({ products: [product()] });
    await GET(req());

    const ordersChain = mockFrom.mock.results
      .map((r) => r.value as { in: { mock: { calls: unknown[][] } } })
      .find((c) => c.in.mock.calls.some((call) => call[0] === "status"));
    expect(ordersChain).toBeDefined();
    const statuses = ordersChain!.in.mock.calls.find((call) => call[0] === "status")![1] as string[];
    expect(statuses).toContain("uploaded");
    expect(statuses).toContain("confirmed");
    for (const gone of ["scanned", "dispatched", "deposit", "in_transit"]) {
      expect(statuses).not.toContain(gone);
    }
  });
});

describe("GET /api/warehouse/stock — reserved counts only parcels that can reach our shelf", () => {
  const engagedOrder = (over: Record<string, unknown> = {}) => ({
    product_id: "p-1",
    quantity: 1,
    status: "uploaded",
    bench_cleared_at: null,
    carrier_extra: null,
    ...over,
  });

  test("an order fulfilled from the carrier's own warehouse reserves nothing here", async () => {
    // Libya, 2026-09-07: 77 live orders shipped from Darb's stock counted as
    // reserved against our shelf, so "available 2" described 214 parcels that
    // would never touch it. Our shelf only (decision of 2026-09-08).
    wire({
      products: [product({ current_stock: 10 })],
      orders: [
        engagedOrder(),
        engagedOrder({ quantity: 4, carrier_extra: { fulfil_from_carrier_warehouse: "true" } }),
        engagedOrder({ quantity: 2, carrier_extra: { fulfil_from_carrier_warehouse: true } }),
      ],
    });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].engaged).toBe(1);
    expect(rows[0].free).toBe(9);
  });

  test("an order cleared from the bench reserves nothing: it will never be scanned here", async () => {
    // The 407 historical Libyan orders cleared on 23 August stay `uploaded`
    // but are not bench work; they stop reserving units (decision of 2026-09-08).
    wire({
      products: [product({ current_stock: 10 })],
      orders: [engagedOrder(), engagedOrder({ quantity: 5, bench_cleared_at: "2026-08-23T10:00:00Z" })],
    });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].engaged).toBe(1);
  });

  test("the query asks for the two exclusion fields, so the filter has something to read", async () => {
    wire({ products: [product()] });
    await GET(req());
    const ordersChain = mockFrom.mock.results
      .map((r) => r.value as { select: { mock: { calls: unknown[][] } }; in: { mock: { calls: unknown[][] } } })
      .find((c) => c.in.mock.calls.some((call) => call[0] === "status"));
    const selected = String(ordersChain!.select.mock.calls[0][0]);
    expect(selected).toContain("bench_cleared_at");
    expect(selected).toContain("carrier_extra");
  });
});


/**
 * Where the units actually are.
 *
 * Libya runs two buildings and `product_site_stock` has ventilated the market
 * total per site since September; no screen has ever shown it. An agent in
 * Benghazi reading the market figure is reading Tripoli's shelf as well as
 * their own. The market total stays the money truth, so the split is a
 * breakdown of it and never replaces it.
 */
describe("GET /api/warehouse/stock — where the units are", () => {
  const sites = [
    { id: "w-tri", code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس", market_id: "m-1" },
    { id: "w-ben", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي", market_id: "m-1" },
  ];

  test("breaks the shelf down by building, named", async () => {
    wire({
      products: [product({ current_stock: 20 })],
      warehouses: sites,
      siteStock: [
        { product_id: "p-1", warehouse_id: "w-tri", current_stock: 12, last_counted_at: "2026-09-01T00:00:00Z" },
        { product_id: "p-1", warehouse_id: "w-ben", current_stock: 5, last_counted_at: null },
      ],
    });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].sites).toEqual([
      { warehouse_id: "w-tri", code: "tripoli", name: "Tripoli", current_stock: 12, last_counted_at: "2026-09-01T00:00:00Z" },
      { warehouse_id: "w-ben", code: "benghazi", name: "Benghazi", current_stock: 5, last_counted_at: null },
    ]);
  });

  test("names what the buildings do not account for rather than hiding it", async () => {
    // The invariant is an inequality: sum(sites) <= market total. The gap is a
    // real quantity nobody has ventilated, and pretending it is zero would make
    // the two figures contradict each other on screen.
    wire({
      products: [product({ current_stock: 20 })],
      warehouses: sites,
      siteStock: [{ product_id: "p-1", warehouse_id: "w-tri", current_stock: 12, last_counted_at: null }],
    });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].unallocated).toBe(8);
  });

  test("says nothing about buildings in a market that has only one", async () => {
    wire({
      products: [product({ current_stock: 20 })],
      warehouses: [sites[0]],
      siteStock: [{ product_id: "p-1", warehouse_id: "w-tri", current_stock: 20, last_counted_at: null }],
    });
    const { rows } = await (await GET(req())).json();
    // Tunisia has one warehouse; a breakdown of one line is noise on the card.
    expect(rows[0].sites).toEqual([]);
    expect(rows[0].unallocated).toBe(0);
  });

  test("never reports a negative gap when a site holds more than the total", async () => {
    wire({
      products: [product({ current_stock: 5 })],
      warehouses: sites,
      siteStock: [{ product_id: "p-1", warehouse_id: "w-tri", current_stock: 9, last_counted_at: null }],
    });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].unallocated).toBe(0);
  });
});

/**
 * Which building, in which language, for whom.
 *
 * The site name is a place painted on a wall — Libya's bench reads Arabic, and
 * `name_ar` was being selected and thrown away. And a super_admin with no market
 * selected must not be handed a breakdown assembled from both markets.
 */
describe("GET /api/warehouse/stock — naming and scoping the buildings", () => {
  const LY = "00000000-0000-0000-0000-000000000002";
  const TN = "00000000-0000-0000-0000-000000000001";

  test("names Libyan buildings in Arabic, as the bench reads them", async () => {
    wire({
      actorMarket: LY,
      products: [product({ market_id: LY })],
      warehouses: [
        { id: "w-tri", code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس", market_id: LY },
        { id: "w-ben", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي", market_id: LY },
      ],
      siteStock: [{ product_id: "p-1", warehouse_id: "w-tri", current_stock: 4, last_counted_at: null }],
    });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].sites[0].name).toBe("طرابلس");
  });

  test("does not mix two markets' buildings into one breakdown", async () => {
    // A super_admin with no market picked: Tunisia has ONE warehouse, so a
    // "breakdown" assembled from both markets would invent a split it does not
    // have — and would name Libyan buildings under a Tunisian product.
    wire({
      actorMarket: TN,
      products: [product({ market_id: TN })],
      warehouses: [
        { id: "w-tn", code: "tunis", name_fr: "Tunis", name_ar: "تونس", market_id: TN },
        { id: "w-tri", code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس", market_id: LY },
        { id: "w-ben", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي", market_id: LY },
      ],
      siteStock: [{ product_id: "p-1", warehouse_id: "w-tn", current_stock: 4, last_counted_at: null }],
    });
    const { rows } = await (await GET(req())).json();
    expect(rows[0].sites).toEqual([]);
    expect(rows[0].unallocated).toBe(0);
  });
});
