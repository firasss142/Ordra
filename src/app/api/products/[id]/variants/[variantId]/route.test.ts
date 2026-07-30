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

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    new URL("http://localhost:3000/api/products/prod-1/variants/var-1"),
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.ilike = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(resolveWith);
  chain.update = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

const admin = { id: "admin-1", role: "super_admin", market_id: null };
const existingVariant = {
  id: "var-1",
  product_id: "prod-1",
  label: "White",
  units_per_pack: 1,
  quantity: 1,
  display_price: 50,
  price_basis: "pack",
  is_active: true,
};

beforeEach(() => vi.clearAllMocks());

describe("PATCH /api/products/[id]/variants/[variantId]", () => {
  function setup(capture: (payload: Record<string, unknown>) => void) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: admin, error: null });
      if (table === "products")
        return queryChain({ data: { market_id: "m-1" }, error: null });
      if (table === "product_variants") {
        const chain = queryChain({ data: existingVariant, error: null });
        chain.update = vi.fn((payload: Record<string, unknown>) => {
          capture(payload);
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { ...existingVariant, ...payload },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });
  }

  test("updates units_per_pack and keeps legacy quantity in sync", async () => {
    let captured: Record<string, unknown> | undefined;
    setup((p) => (captured = p));

    const res = await PATCH(makeRequest({ units_per_pack: 4 }), {
      params: Promise.resolve({ id: "prod-1", variantId: "var-1" }),
    });

    expect(res.status).toBe(200);
    expect(captured).toMatchObject({ units_per_pack: 4, quantity: 4 });
  });

  test("updates price_basis", async () => {
    let captured: Record<string, unknown> | undefined;
    setup((p) => (captured = p));

    const res = await PATCH(makeRequest({ price_basis: "unit" }), {
      params: Promise.resolve({ id: "prod-1", variantId: "var-1" }),
    });

    expect(res.status).toBe(200);
    expect(captured).toMatchObject({ price_basis: "unit" });
  });

  test("rejects invalid price_basis", async () => {
    setup(() => {});
    const res = await PATCH(makeRequest({ price_basis: "nope" }), {
      params: Promise.resolve({ id: "prod-1", variantId: "var-1" }),
    });
    expect(res.status).toBe(400);
  });

  test("rejects units_per_pack < 1", async () => {
    setup(() => {});
    const res = await PATCH(makeRequest({ units_per_pack: 0 }), {
      params: Promise.resolve({ id: "prod-1", variantId: "var-1" }),
    });
    expect(res.status).toBe(400);
  });
});
