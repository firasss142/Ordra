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

// Chainable query mock that records every builder call. Awaitable (thenable)
// -> resolves to { data, error }.
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

  test("market_manager without a market is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: null } }));
    const res = await GET(getReq("?type=products"));
    expect(res.status).toBe(403);
  });

  test("products: candidate query is market-scoped, pre-confirmation, requires an external_variant_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const ordersChain = chain({
      data: [{ id: "o-1", storefront_id: "sf-1", external_variant_id: "v-1" }],
    });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(ordersChain)
      .mockReturnValueOnce(chain({ data: [] })); // no existing product mappings

    const res = await GET(getReq("?type=products"));
    expect(res.status).toBe(200);

    const calls = ordersChain.__calls as Array<{ method: string; args: unknown[] }>;
    expect(calls).toContainEqual({ method: "eq", args: ["market_id", "m-tn"] });
    expect(calls).toContainEqual({ method: "neq", args: ["mapping_status", "mapped"] });
    expect(calls).toContainEqual({ method: "not", args: ["external_variant_id", "is", null] });
    // it must NOT filter on product_id any more — name-matched orders must pass through
    expect(calls.some((c) => c.method === "is" && c.args[0] === "product_id")).toBe(false);
  });

  test("products: surfaces a name-matched order (has product_id) when no mapping row exists", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    // order resolved by name: product_id IS set, but no mapping row.
    const nameMatched = {
      id: "o-name",
      storefront_id: "sf-1",
      external_variant_id: "48611571007703",
      product_id: "prod-quran",
      mapping_status: "needs_review",
    };
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: [nameMatched] }))
      .mockReturnValueOnce(chain({ data: [] })); // storefront_product_mappings: none

    const res = await GET(getReq("?type=products"));
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("o-name");
  });

  test("products: drops an order once an explicit mapping row exists for its variant", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const orders = [
      { id: "o-bound", storefront_id: "sf-1", external_variant_id: "v-bound" },
      { id: "o-open", storefront_id: "sf-1", external_variant_id: "v-open" },
    ];
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: orders }))
      .mockReturnValueOnce(
        chain({ data: [{ storefront_id: "sf-1", external_variant_id: "v-bound" }] }),
      );

    const res = await GET(getReq("?type=products"));
    const json = await res.json();
    // o-bound has a mapping row -> filtered out; o-open stays
    expect(json.data.map((o: { id: string }) => o.id)).toEqual(["o-open"]);
  });

  test("cities: candidate query is the 'city did not resolve' signal — has customer_city, no destination columns", async () => {
    // City resolution is name-only and deterministic at intake, so the cities
    // tab is exactly the orders whose city did not resolve: a customer_city is
    // present but neither city_id nor dexpress_state_id is set. No second query.
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const ordersChain = chain({
      data: [
        {
          id: "o-1",
          customer_city: "Sfax",
          city_id: null,
          dexpress_state_id: null,
        },
      ],
    });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(ordersChain);

    const res = await GET(getReq("?type=cities"));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.map((o: { id: string }) => o.id)).toEqual(["o-1"]);

    const calls = ordersChain.__calls as Array<{ method: string; args: unknown[] }>;
    expect(calls).toContainEqual({ method: "neq", args: ["mapping_status", "mapped"] });
    expect(calls).toContainEqual({ method: "not", args: ["customer_city", "is", null] });
    expect(calls).toContainEqual({ method: "is", args: ["city_id", null] });
    expect(calls).toContainEqual({ method: "is", args: ["dexpress_state_id", null] });
    // no external_city_mappings second pass — only users + orders queries ran
    expect(mockFrom).toHaveBeenCalledTimes(2);
    expect(mockFrom.mock.calls.map((c) => c[0])).not.toContain("external_city_mappings");
  });

  test("returns an empty list (no second query) when there are no candidate orders", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-tn" } }))
      .mockReturnValueOnce(chain({ data: [] }));

    const res = await GET(getReq("?type=products"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([]);
    // only users + orders queries ran — no mapping-table lookup
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });

  test("cities: a Libya order whose dexpress_state_id is set never surfaces", async () => {
    // Libya orders resolve to dexpress_state_id (city_id stays null). The
    // cities-tab query excludes any order with EITHER destination column set,
    // so a bound Libya order is filtered out by the query itself — there is no
    // second pass that could miss it.
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    // The query already excludes bound orders, so the DB returns only the
    // still-unresolved one.
    const ordersChain = chain({
      data: [
        {
          id: "o-open",
          customer_city: "مدينة غير معروفة",
          city_id: null,
          dexpress_state_id: null,
        },
      ],
    });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: "m-ly" } }))
      .mockReturnValueOnce(ordersChain);

    const res = await GET(getReq("?type=cities"));
    const json = await res.json();
    expect(json.data.map((o: { id: string }) => o.id)).toEqual(["o-open"]);

    const calls = ordersChain.__calls as Array<{ method: string; args: unknown[] }>;
    expect(calls).toContainEqual({ method: "is", args: ["dexpress_state_id", null] });
    expect(mockFrom).toHaveBeenCalledTimes(2);
  });
});
