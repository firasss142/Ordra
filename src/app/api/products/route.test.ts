import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function singleChain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

function postReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/products — stock integrity lockdown", () => {
  test("rejects market_manager with 403 (product management is super_admin only)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "market_manager", market_id: "m-tn" }),
    );
    const res = await POST(
      postReq({ name: "Test", unit_cogs: 1, packing_cost: 1 }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects warehouse_agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "warehouse_agent", market_id: "m-tn" }),
    );
    const res = await POST(
      postReq({ name: "Test", unit_cogs: 1, packing_cost: 1 }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "ag-1" } } });
    mockFrom.mockReturnValueOnce(
      singleChain({ role: "agent", market_id: "m-tn" }),
    );
    const res = await POST(
      postReq({ name: "Test", unit_cogs: 1, packing_cost: 1 }),
    );
    expect(res.status).toBe(403);
  });
});
