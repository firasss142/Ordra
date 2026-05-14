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

// Chainable query mock that records every builder call so the test can assert
// on the filters applied. Awaitable (thenable) -> resolves to { data, error }.
function chain(result: { data: unknown; error?: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const c: Record<string, unknown> = { __calls: calls };
  const methods = ["select", "eq", "in", "is", "not", "neq", "order", "limit"];
  for (const m of methods) {
    c[m] = vi.fn((...args: unknown[]) => {
      calls.push({ method: m, args });
      return c;
    });
  }
  c.single = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.maybeSingle = vi.fn().mockResolvedValue({ data: result.data, error: result.error ?? null });
  c.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve({ data: result.data, error: result.error ?? null }).then(resolve);
  return c;
}

function getReq(query = "") {
  return new NextRequest(new URL(`http://localhost/api/mappings/unmatched${query}`), {
    method: "GET",
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("GET /api/mappings/unmatched", () => {
  test("agent is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "agent", market_id: "m-tn" } }));
    const res = await GET(getReq("?type=products"));
    expect(res.status).toBe(403);
  });

  test("rejects a missing or invalid type param", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }));
    const res = await GET(getReq()); // no ?type
    expect(res.status).toBe(400);

    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }));
    const res2 = await GET(getReq("?type=bogus"));
    expect(res2.status).toBe(400);
  });

  test("products: filters to orders missing a product but carrying an external_variant_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const ordersChain = chain({ data: [{ id: "o-1", external_variant_id: "v-1" }] });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(ordersChain);

    const res = await GET(getReq("?type=products"));
    expect(res.status).toBe(200);

    const calls = (ordersChain.__calls as Array<{ method: string; args: unknown[] }>);
    // product_id IS NULL  AND  external_variant_id IS NOT NULL
    expect(calls).toContainEqual({ method: "is", args: ["product_id", null] });
    expect(calls).toContainEqual({ method: "not", args: ["external_variant_id", "is", null] });
    // market-scoped, pre-confirmation only, excludes already-mapped
    expect(calls).toContainEqual({ method: "eq", args: ["market_id", "m-tn"] });
    expect(calls).toContainEqual({ method: "neq", args: ["mapping_status", "mapped"] });
  });

  test("cities: filters to orders missing a city but carrying an external_city_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const ordersChain = chain({ data: [{ id: "o-2", external_city_id: "3" }] });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(ordersChain);

    const res = await GET(getReq("?type=cities"));
    expect(res.status).toBe(200);

    const calls = (ordersChain.__calls as Array<{ method: string; args: unknown[] }>);
    expect(calls).toContainEqual({ method: "is", args: ["city_id", null] });
    expect(calls).toContainEqual({ method: "not", args: ["external_city_id", "is", null] });
  });

  test("market_manager without a market is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: null } }));
    const res = await GET(getReq("?type=products"));
    expect(res.status).toBe(403);
  });
});
