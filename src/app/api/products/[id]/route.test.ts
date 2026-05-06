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

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("PATCH /api/products/[id] — stock integrity lockdown", () => {
  test("rejects market_manager with 403 even for their own market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    // First from() is user lookup, second is product fetch
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "market_manager", market_id: "m-tn" }))
      .mockReturnValueOnce(singleChain({ id: "p-1", market_id: "m-tn", name: "X", unit_cogs: 1, packing_cost: 1, confirmation_processing_cost: 0, default_price: null, low_stock_threshold: 0, is_active: true }));
    const res = await PATCH(patchReq({ name: "Updated" }), params);
    expect(res.status).toBe(403);
  });

  test("rejects warehouse_agent with 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "warehouse_agent", market_id: "m-tn" }))
      .mockReturnValueOnce(singleChain({ id: "p-1", market_id: "m-tn", name: "X", unit_cogs: 1, packing_cost: 1, confirmation_processing_cost: 0, default_price: null, low_stock_threshold: 0, is_active: true }));
    const res = await PATCH(patchReq({ name: "Updated" }), params);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /api/products/[id] — sku/description/image_url passthrough", () => {
  function updateChain(data: unknown, error: unknown = null) {
    const c: Record<string, unknown> = {};
    const updateSpy = vi.fn().mockReturnValue(c);
    c.update = updateSpy;
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({ data, error });
    return { chain: c, updateSpy };
  }

  const existing = {
    id: "p-1",
    market_id: "m-tn",
    name: "X",
    sku: null,
    description: null,
    image_url: null,
    unit_cogs: 1,
    packing_cost: 0,
    confirmation_processing_cost: 0,
    default_price: null,
    low_stock_threshold: 0,
    current_stock: 0,
    is_active: true,
  };

  test("super_admin PATCH persists sku, description, image_url", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = updateChain({ ...existing, sku: "BV-01" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(singleChain(existing))
      .mockReturnValueOnce(products.chain);

    const res = await PATCH(
      patchReq({
        sku: "BV-01",
        description: "Belle bouteille",
        image_url: "https://example.com/img.png",
      }),
      params,
    );

    expect(res.status).toBe(200);
    const updates = products.updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updates.sku).toBe("BV-01");
    expect(updates.description).toBe("Belle bouteille");
    expect(updates.image_url).toBe("https://example.com/img.png");
  });

  test("empty sku string is normalized to null (so unique index allows clearing)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = updateChain({ ...existing, sku: null });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(singleChain({ ...existing, sku: "OLD" }))
      .mockReturnValueOnce(products.chain);

    await PATCH(patchReq({ sku: "" }), params);

    const updates = products.updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(updates.sku).toBeNull();
  });

  test("returns 409 when sku collides (unique index 23505)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const products = updateChain(null, { code: "23505", message: "duplicate key" });
    mockFrom
      .mockReturnValueOnce(singleChain({ role: "super_admin", market_id: null }))
      .mockReturnValueOnce(singleChain(existing))
      .mockReturnValueOnce(products.chain);

    const res = await PATCH(patchReq({ sku: "DUP" }), params);
    expect(res.status).toBe(409);
  });
});
