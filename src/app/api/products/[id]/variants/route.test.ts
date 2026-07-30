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

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest(
    new URL("http://localhost:3000/api/products/prod-1/variants"),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.ilike = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockResolvedValue(resolveWith);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

const admin = { id: "admin-1", role: "super_admin", market_id: null };

beforeEach(() => vi.clearAllMocks());

describe("POST /api/products/[id]/variants", () => {
  function setup(capture: (payload: Record<string, unknown>) => void) {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return queryChain({ data: admin, error: null });
      if (table === "products")
        return queryChain({ data: { market_id: "m-1" }, error: null });
      if (table === "product_variants") {
        const chain = queryChain({ data: null, error: null });
        // duplicate-label check resolves empty
        chain.limit = vi.fn().mockResolvedValue({ data: [], error: null });
        chain.insert = vi.fn((payload: Record<string, unknown>) => {
          capture(payload);
          return {
            select: vi.fn().mockReturnValue({
              single: vi
                .fn()
                .mockResolvedValue({ data: { id: "var-1", ...payload }, error: null }),
            }),
          };
        });
        return chain;
      }
      return queryChain({ data: null, error: null });
    });
  }

  test("persists units_per_pack and price_basis", async () => {
    let captured: Record<string, unknown> | undefined;
    setup((p) => (captured = p));

    const res = await POST(
      makeRequest({
        label: "White · pack of 2",
        units_per_pack: 2,
        display_price: 89,
        price_basis: "pack",
      }),
      { params: Promise.resolve({ id: "prod-1" }) },
    );

    expect(res.status).toBe(201);
    expect(captured).toMatchObject({
      label: "White · pack of 2",
      units_per_pack: 2,
      quantity: 2, // legacy column kept in sync during rollout
      display_price: 89,
      price_basis: "pack",
    });
  });

  test("defaults price_basis to 'pack' when omitted", async () => {
    let captured: Record<string, unknown> | undefined;
    setup((p) => (captured = p));

    const res = await POST(
      makeRequest({ label: "Blue", units_per_pack: 1, display_price: 50 }),
      { params: Promise.resolve({ id: "prod-1" }) },
    );

    expect(res.status).toBe(201);
    expect(captured).toMatchObject({ price_basis: "pack", units_per_pack: 1 });
  });

  test("accepts legacy 'quantity' as units_per_pack when units_per_pack absent", async () => {
    let captured: Record<string, unknown> | undefined;
    setup((p) => (captured = p));

    const res = await POST(
      makeRequest({ label: "Green", quantity: 3, display_price: 120 }),
      { params: Promise.resolve({ id: "prod-1" }) },
    );

    expect(res.status).toBe(201);
    expect(captured).toMatchObject({ units_per_pack: 3, quantity: 3 });
  });

  test("rejects invalid price_basis", async () => {
    setup(() => {});
    const res = await POST(
      makeRequest({
        label: "Bad",
        units_per_pack: 1,
        display_price: 50,
        price_basis: "wholesale",
      }),
      { params: Promise.resolve({ id: "prod-1" }) },
    );
    expect(res.status).toBe(400);
  });

  test("rejects units_per_pack < 1", async () => {
    setup(() => {});
    const res = await POST(
      makeRequest({ label: "Bad", units_per_pack: 0, display_price: 50 }),
      { params: Promise.resolve({ id: "prod-1" }) },
    );
    expect(res.status).toBe(400);
  });
});
