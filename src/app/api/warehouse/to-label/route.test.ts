import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock("@/lib/warehouse/zone-index-cache", () => ({
  // An empty directory: every row resolves to "zone unknown", which is all
  // these tests need. The shape must match ZoneIndex or zoneForOrder throws.
  getZoneIndex: vi.fn().mockResolvedValue({
    destinations: { byName: new Map(), cityColors: new Map() },
    colorByBranchGroup: new Map(),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

/**
 * The bench queue.
 *
 * Every figure on Préparation describes the WHOLE queue and is counted
 * server-side, so the numbers this route forwards are the numbers the screen
 * shows. A count that stops describing the same set as the rows is the bug
 * this file exists to catch.
 */

function req() {
  return new NextRequest(new URL("http://localhost/api/warehouse/to-label?limit=100"));
}

function wire(stats: Record<string, unknown>, orders: unknown[] = [], products: unknown[] = []) {
  mockFrom.mockImplementation((table: string) => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.in = vi.fn().mockReturnValue(c);
    c.then = (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: table === "products" ? products : [], error: null }).then(resolve);
    c.single = vi.fn().mockResolvedValue({
      data: { role: "warehouse_agent", market_id: "m-1" },
      error: null,
    });
    c.maybeSingle = vi.fn().mockResolvedValue({
      data: { role: "warehouse_agent", market_id: "m-1" },
      error: null,
    });
    return c;
  });
  mockRpc.mockImplementation((fn: string) => {
    if (fn === "get_to_label_orders") return Promise.resolve({ data: orders, error: null });
    if (fn === "get_warehouse_queue_stats") return Promise.resolve({ data: stats, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
});

describe("GET /api/warehouse/to-label", () => {
  test("reports how many orders were set aside, so an empty bench is explained", async () => {
    // The bench was cleared: nothing is queued, but 410 orders did not
    // evaporate. A screen that just goes blank reads as broken.
    wire({ to_prepare: 0, set_aside: 410 });
    const json = await (await GET(req())).json();
    expect(json.total).toBe(0);
    expect(json.setAside).toBe(410);
  });

  test("set_aside defaults to 0 rather than undefined", async () => {
    wire({ to_prepare: 12 });
    const json = await (await GET(req())).json();
    expect(json.setAside).toBe(0);
  });
});

describe("GET /api/warehouse/to-label — the picture on the row", () => {
  test("each row carries its product's image, looked up once per page", async () => {
    // The card showed a package icon for every parcel: the RPC returns order
    // fields only, and the picture the picker matches lives on the product.
    wire(
      { to_prepare: 2 },
      [
        { id: "o1", product_id: "p1", customer_city: "طرابلس", created_at: "2026-09-01T00:00:00Z" },
        { id: "o2", product_id: "p2", customer_city: "طرابلس", created_at: "2026-09-01T00:00:00Z" },
      ],
      [{ id: "p1", image_url: "https://img/p1.png" }],
    );
    const json = await (await GET(req())).json();
    expect(json.orders[0].product_image_url).toBe("https://img/p1.png");
    expect(json.orders[1].product_image_url).toBeNull();
  });
});
