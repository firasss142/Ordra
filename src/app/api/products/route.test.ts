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

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

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

describe("POST /api/products — sku handling", () => {
  function insertChain(data: unknown, error: unknown = null) {
    const c: Record<string, unknown> = {};
    const insertSpy = vi.fn().mockReturnValue(c);
    c.insert = insertSpy;
    c.select = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({ data, error });
    return { chain: c, insertSpy };
  }

  test("super_admin POST persists sku in the inserted row", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = insertChain({ id: "p-new", name: "X", sku: "BV-01" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(products.chain);

    const res = await POST(
      postReq({
        name: "X",
        unit_cogs: 1,
        packing_cost: 0,
        market_id: "m-tn",
        sku: "BV-01",
      }),
    );

    expect(res.status).toBe(201);
    expect(products.insertSpy).toHaveBeenCalled();
    const insertedRow = products.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedRow.sku).toBe("BV-01");
  });

  test("super_admin POST does not include sku when omitted by client", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = insertChain({ id: "p-new", name: "X" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(products.chain);

    await POST(
      postReq({
        name: "X",
        unit_cogs: 1,
        packing_cost: 0,
        market_id: "m-tn",
      }),
    );

    const insertedRow = products.insertSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(insertedRow.sku).toBeNull();
  });

  test("returns 409 when SKU collides (unique index 23505)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = insertChain(null, { code: "23505", message: "duplicate key" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(products.chain);

    const res = await POST(
      postReq({
        name: "X",
        unit_cogs: 1,
        packing_cost: 0,
        market_id: "m-tn",
        sku: "DUP",
      }),
    );

    expect(res.status).toBe(409);
  });
});
