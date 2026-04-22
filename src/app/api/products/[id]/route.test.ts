import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { PATCH } from "./route";
import { NextRequest } from "next/server";

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function patchReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products/p-1"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "p-1" }) };

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/products/[id] — stock integrity lockdown", () => {
  test("rejects market_manager with 403 even for their own market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    // First from() is user lookup, second is product fetch
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "market_manager", market_id: "m-tn" }))
      .mockReturnValueOnce(singleChain({ id: "p-1", market_id: "m-tn", name: "X", unit_cogs: 1, packing_cost: 1, cpl: 0, confirmation_processing_cost: 0, default_price: null, low_stock_threshold: 0, is_active: true }));
    const res = await PATCH(patchReq({ name: "Updated" }), params);
    expect(res.status).toBe(403);
  });

  test("rejects warehouse_agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "warehouse_agent", market_id: "m-tn" }))
      .mockReturnValueOnce(singleChain({ id: "p-1", market_id: "m-tn", name: "X", unit_cogs: 1, packing_cost: 1, cpl: 0, confirmation_processing_cost: 0, default_price: null, low_stock_threshold: 0, is_active: true }));
    const res = await PATCH(patchReq({ name: "Updated" }), params);
    expect(res.status).toBe(403);
  });
});
