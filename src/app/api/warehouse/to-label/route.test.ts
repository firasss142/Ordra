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
  getZoneIndex: vi.fn().mockResolvedValue({ byCity: new Map(), byCityArea: new Map() }),
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

function wire(stats: Record<string, unknown>, orders: unknown[] = []) {
  mockFrom.mockImplementation(() => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
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
