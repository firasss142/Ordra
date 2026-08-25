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
}

function wire({ products = [], orders = [], counts = [], series = [], accuracy = null }: Wire) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return chain({ data: { role: "warehouse_agent", market_id: "m-1" }, error: null });
    if (table === "products") return chain({ data: products, error: null });
    if (table === "orders") return chain({ data: orders, error: null });
    if (table === "inventory_log") return chain({ data: counts, error: null });
    return chain({ data: [], error: null });
  });
  // getActor reads users via .single(); give the chain one.
  const original = mockFrom.getMockImplementation()!;
  mockFrom.mockImplementation((table: string) => {
    const c = original(table) as Record<string, unknown>;
    c.single = vi.fn().mockResolvedValue({ data: { role: "warehouse_agent", market_id: "m-1" }, error: null });
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
