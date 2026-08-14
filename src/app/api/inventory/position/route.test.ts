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

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/inventory/position");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

const userSingleChain = (role: string, market_id: string | null) => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return chain;
};

const settingsChain = (rows: unknown[] = []) => {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockResolvedValue({ data: rows, error: null });
  return chain;
};

function asSuperAdmin() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } }, error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === "users") return userSingleChain("super_admin", null);
    return settingsChain([]);
  });
  mockRpc.mockResolvedValue({ data: { products: [], ledger_health: {} }, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/inventory/position — access", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    expect((await GET(createRequest())).status).toBe(401);
  });

  for (const role of ["agent", "warehouse_agent", "market_manager"]) {
    test(`returns 403 for ${role}`, async () => {
      mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } }, error: null });
      mockFrom.mockImplementation((table: string) => {
        if (table === "users") return userSingleChain(role, "m-1");
        return settingsChain([]);
      });
      expect((await GET(createRequest())).status).toBe(403);
    });
  }

  test("returns 200 for super_admin, wrapped in a data envelope", async () => {
    asSuperAdmin();
    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toBeDefined();
    expect(body.data.products).toEqual([]);
  });
});

describe("GET /api/inventory/position — window", () => {
  test("defaults to a 28-day window bucketed by day", async () => {
    asSuperAdmin();
    await GET(createRequest());
    const args = mockRpc.mock.calls[0][1];
    expect(args.p_bucket_days).toBe(1);
    const span =
      (Date.parse(`${args.p_to}T00:00:00Z`) - Date.parse(`${args.p_from}T00:00:00Z`)) / 86_400_000;
    expect(span).toBe(27); // 28 days inclusive
  });

  test("a 90-day window buckets by week so the sparkline stays readable", async () => {
    asSuperAdmin();
    await GET(createRequest({ window: "90" }));
    expect(mockRpc.mock.calls[0][1].p_bucket_days).toBe(7);
  });

  test("rejects a window the UI cannot produce rather than coercing it", async () => {
    asSuperAdmin();
    expect((await GET(createRequest({ window: "45" }))).status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("passes the return-rate window as a separate, wider bound", async () => {
    asSuperAdmin();
    await GET(createRequest({ window: "7" }));
    const args = mockRpc.mock.calls[0][1];
    const rateSpan =
      (Date.parse(`${args.p_to}T00:00:00Z`) - Date.parse(`${args.p_rate_from}T00:00:00Z`)) /
      86_400_000;
    expect(rateSpan).toBe(89);
  });
});

describe("GET /api/inventory/position — scope", () => {
  test("forwards an explicit market for a super_admin", async () => {
    asSuperAdmin();
    await GET(createRequest({ market_id: "m-ly" }));
    expect(mockRpc.mock.calls[0][1].p_market_id).toBe("m-ly");
  });

  test("passes null for the all-markets scope", async () => {
    asSuperAdmin();
    await GET(createRequest());
    expect(mockRpc.mock.calls[0][1].p_market_id).toBeNull();
  });
});

describe("GET /api/inventory/position — failure", () => {
  test("returns 500 with no partial body when the RPC fails", async () => {
    asSuperAdmin();
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(createRequest());
    expect(res.status).toBe(500);
    expect((await res.json()).data).toBeUndefined();
  });
});
