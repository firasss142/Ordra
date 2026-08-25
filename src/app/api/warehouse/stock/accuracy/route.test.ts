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
 * Count accuracy — the only accuracy this warehouse can honestly claim.
 *
 * The mockup prints "Accuracy 99.5 %" on the dashboard. There is no ground
 * truth at scan time, so the figure here is how close the books were to the
 * shelf the last time a human counted it — and it is NULL until somebody has.
 */
function wire(actor: Record<string, unknown> | null = { role: "warehouse_agent", market_id: "m-1" }) {
  mockFrom.mockImplementation(() => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({ data: actor, error: null });
    c.maybeSingle = c.single;
    return c;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
});

const req = () => new NextRequest(new URL("http://localhost/api/warehouse/stock/accuracy"));

describe("GET /api/warehouse/stock/accuracy", () => {
  test("passes the market scope to the RPC", async () => {
    wire();
    mockRpc.mockResolvedValue({ data: { accuracy: 98, counted_products: 4, products: [] }, error: null });
    const json = await (await GET(req())).json();
    expect(mockRpc).toHaveBeenCalledWith("get_count_accuracy", {
      p_market_id: "m-1",
      p_days: 90,
    });
    expect(json.accuracy).toBe(98);
    expect(json.counted_products).toBe(4);
  });

  test("null accuracy stays null — never coerced to zero or a hundred", async () => {
    wire();
    mockRpc.mockResolvedValue({ data: { accuracy: null, counted_products: 0, products: [] }, error: null });
    const json = await (await GET(req())).json();
    expect(json.accuracy).toBeNull();
  });

  test("a database failure is an empty verdict, not a fake perfect score", async () => {
    wire();
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(req());
    expect(res.status).toBe(500);
  });

  test("403 for a role that cannot see the warehouse", async () => {
    wire({ role: "agent", market_id: "m-1" });
    expect((await GET(req())).status).toBe(403);
  });
});
