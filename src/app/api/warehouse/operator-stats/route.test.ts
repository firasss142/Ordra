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

import { GET } from "./route";
import { NextRequest } from "next/server";

function req() {
  return new NextRequest(
    new URL("http://localhost/api/warehouse/operator-stats"),
  );
}

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/warehouse/operator-stats — auth", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "agent", market_id: "m-1" }));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/warehouse/operator-stats — success", () => {
  test("returns stats for warehouse_agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(
      singleChain({ role: "warehouse_agent", market_id: "m-1" }),
    );
    mockRpc.mockResolvedValue({
      data: {
        labels_printed_today: 12,
        orders_scanned_today: 10,
        avg_cycle_seconds: 180,
      },
      error: null,
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.labels_printed_today).toBe(12);
    expect(json.orders_scanned_today).toBe(10);
    expect(json.avg_cycle_seconds).toBe(180);
    expect(mockRpc).toHaveBeenCalledWith("get_operator_prep_stats", {
      p_actor_id: "wh-1",
    });
  });

  test("returns zero stats when RPC returns null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(
      singleChain({ role: "warehouse_agent", market_id: "m-1" }),
    );
    mockRpc.mockResolvedValue({ data: null, error: null });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.labels_printed_today).toBe(0);
    expect(json.orders_scanned_today).toBe(0);
  });

  test("returns 500 on DB error", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValue(
      singleChain({ role: "warehouse_agent", market_id: "m-1" }),
    );
    mockRpc.mockResolvedValue({ data: null, error: { message: "db fail" } });

    const res = await GET(req());
    expect(res.status).toBe(500);
  });

  test("market_manager can access operator stats", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValue(
      singleChain({ role: "market_manager", market_id: "m-1" }),
    );
    mockRpc.mockResolvedValue({
      data: { labels_printed_today: 5, orders_scanned_today: 3, avg_cycle_seconds: 90 },
      error: null,
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
  });
});
