import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  c.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  c.then = undefined;
  return c;
}

function listChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.then = (fn: (v: { data: unknown; error: unknown }) => unknown) =>
    Promise.resolve(fn({ data, error }));
  return c;
}

function authedWarehouse() {
  mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
  mockFrom.mockImplementationOnce(() =>
    singleChain({ role: "warehouse_agent", market_id: "m-1" }),
  );
}

function makeReq(url: string) {
  return new NextRequest(new URL(url));
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/warehouse/returns/rate — role guard", () => {
  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(singleChain({ role: "agent", market_id: "m-1" }));
    const res = await GET(
      makeReq("http://localhost/api/warehouse/returns/rate?product_id=p-1"),
    );
    expect(res.status).toBe(403);
  });
});

describe("GET /api/warehouse/returns/rate — input", () => {
  test("400 when neither product_id nor product_ids given", async () => {
    authedWarehouse();
    const res = await GET(
      makeReq("http://localhost/api/warehouse/returns/rate"),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/warehouse/returns/rate — stats", () => {
  test("returns per-product stats for single product_id", async () => {
    authedWarehouse();
    mockFrom.mockReturnValueOnce(
      listChain([
        {
          product_id: "p-1",
          market_id: "m-1",
          delivered_count: 22,
          returned_count: 2,
          damaged_count: 1,
        },
      ]),
    );
    const res = await GET(
      makeReq("http://localhost/api/warehouse/returns/rate?product_id=p-1"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rates).toHaveLength(1);
    expect(json.rates[0]).toEqual(
      expect.objectContaining({
        product_id: "p-1",
        delivered: 22,
        returned: 2,
        damaged: 1,
        total: 25,
        return_rate_percent: 12,
      }),
    );
  });

  test("returns zero rate when no data", async () => {
    authedWarehouse();
    mockFrom.mockReturnValueOnce(listChain([]));
    const res = await GET(
      makeReq("http://localhost/api/warehouse/returns/rate?product_id=p-unknown"),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rates).toEqual([]);
  });
});
