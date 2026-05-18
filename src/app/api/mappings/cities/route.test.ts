import { describe, test, expect, vi, beforeEach } from "vitest";
import { LY_MARKET_ID, TN_MARKET_ID } from "@/lib/markets";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

// Chainable query mock. Records builder calls; awaitable (thenable) -> { data, error }.
function chain(result: { data: unknown; error?: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const c: Record<string, unknown> = { __calls: calls };
  const methods = ["select", "eq", "in", "is", "not", "neq", "order", "update", "insert"];
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
  return new NextRequest(new URL(`http://localhost/api/mappings/cities${query}`), {
    method: "GET",
  });
}
function postReq(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/mappings/cities"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("GET /api/mappings/cities", () => {
  test("agent is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "agent", market_id: TN_MARKET_ID } }));
    const res = await GET(getReq(`?market_id=${TN_MARKET_ID}`));
    expect(res.status).toBe(403);
  });

  test("market_manager without a market is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: null } }));
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });

  test("Tunisia: scopes mappings through the market's cities", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const mappingsChain = chain({ data: [{ id: "map-1", city_id: "city-tunis" }] });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(chain({ data: [{ id: "city-tunis", market_id: TN_MARKET_ID }] }))
      .mockReturnValueOnce(mappingsChain);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    // the mappings query is scoped by city_id
    const calls = mappingsChain.__calls as Array<{ method: string; args: unknown[] }>;
    expect(calls.some((c) => c.method === "in" && c.args[0] === "city_id")).toBe(true);
  });

  test("Libya: lists Dexpress-bound mappings (dexpress_state_id not null), no cities scoping", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    const mappingsChain = chain({
      data: [{ id: "map-ly", dexpress_state_id: 16, city_id: null }],
    });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }))
      .mockReturnValueOnce(mappingsChain);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    // it filters on dexpress_state_id IS NOT NULL, and never queries cities
    const calls = mappingsChain.__calls as Array<{ method: string; args: unknown[] }>;
    expect(calls).toContainEqual({ method: "not", args: ["dexpress_state_id", "is", null] });
    expect(mockFrom.mock.calls.map((c) => c[0])).not.toContain("cities");
  });
});

describe("POST /api/mappings/cities", () => {
  test("agent is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "agent", market_id: TN_MARKET_ID } }));
    const res = await POST(
      postReq({ platform: "shopify", external_city_id: "3", city_id: "c-1" }),
    );
    expect(res.status).toBe(403);
  });

  test("rejects missing platform / external_city_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }));
    const res = await POST(postReq({ platform: "shopify" }));
    expect(res.status).toBe(400);
  });

  // --- Tunisia path --------------------------------------------------------

  test("Tunisia: requires city_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }));
    const res = await POST(postReq({ platform: "shopify", external_city_id: "3" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/city_id is required/i);
  });

  test("Tunisia: creates a city mapping and back-fills orders.city_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(chain({ data: { id: "c-1", market_id: TN_MARKET_ID } })) // city lookup
      .mockReturnValueOnce(chain({ data: { id: "map-1" } })) // insert mapping
      .mockReturnValueOnce(chain({ data: [{ id: "o-1", product_id: "p-1" }] })) // open orders
      .mockReturnValueOnce(chain({ data: null })); // update o-1

    const res = await POST(
      postReq({ platform: "shopify", external_city_id: "3", city_id: "c-1" }),
    );
    expect(res.status).toBe(201);
    expect((await res.json()).backfilled).toBe(1);

    // the mapping row carries city_id, dexpress_state_id null
    const insertChain = mockFrom.mock.results[2].value;
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ city_id: "c-1", dexpress_state_id: null }),
    );
    // the order was back-filled with city_id (product already set -> mapped)
    const updateChain = mockFrom.mock.results[4].value;
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ city_id: "c-1", dexpress_state_id: null, mapping_status: "mapped" }),
    );
  });

  test("Tunisia: rejects a city that is not in the target market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(chain({ data: { id: "c-ly", market_id: LY_MARKET_ID } }));
    const res = await POST(
      postReq({ platform: "shopify", external_city_id: "3", city_id: "c-ly" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not in the target market/i);
  });

  // --- Libya path ----------------------------------------------------------

  test("Libya: requires dexpress_state_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }));
    const res = await POST(
      postReq({ platform: "buybox", external_city_id: "51", city_id: "should-be-ignored" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/dexpress_state_id is required/i);
  });

  test("Libya: bad dexpress_state_id -> 404", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }))
      .mockReturnValueOnce(chain({ data: null })); // dexpress_states lookup miss
    const res = await POST(
      postReq({ platform: "buybox", external_city_id: "51", dexpress_state_id: 99999 }),
    );
    expect(res.status).toBe(404);
  });

  test("Libya: creates a Dexpress mapping and back-fills orders.dexpress_state_id, city_id stays null", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }))
      .mockReturnValueOnce(chain({ data: { id: 16 } })) // dexpress_states lookup hit
      .mockReturnValueOnce(chain({ data: { id: "map-ly" } })) // insert mapping
      .mockReturnValueOnce(chain({ data: [{ id: "o-ly", product_id: null }] })) // open orders
      .mockReturnValueOnce(chain({ data: null })); // update o-ly

    const res = await POST(
      postReq({ platform: "buybox", external_city_id: "51", dexpress_state_id: 16 }),
    );
    expect(res.status).toBe(201);

    // the mapping row carries dexpress_state_id, city_id null
    const insertChain = mockFrom.mock.results[2].value;
    expect(insertChain.insert).toHaveBeenCalledWith(
      expect.objectContaining({ dexpress_state_id: 16, city_id: null }),
    );
    // the order back-fill sets dexpress_state_id, clears city_id; product null -> needs_review
    const updateChain = mockFrom.mock.results[4].value;
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        dexpress_state_id: 16,
        city_id: null,
        mapping_status: "needs_review",
      }),
    );
  });

  test("super_admin must pass market_id in the body", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }));
    const res = await POST(
      postReq({ platform: "buybox", external_city_id: "51", dexpress_state_id: 16 }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/market_id is required/i);
  });

  test("returns 409 on a duplicate mapping", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }))
      .mockReturnValueOnce(chain({ data: { id: 16 } }))
      .mockReturnValueOnce(chain({ data: null, error: { code: "23505" } }));
    const res = await POST(
      postReq({ platform: "buybox", external_city_id: "51", dexpress_state_id: 16 }),
    );
    expect(res.status).toBe(409);
  });
});
