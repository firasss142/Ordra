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

// ---------------------------------------------------------------------------
// GET — returns the destination list for the target market (the dropdown
// options the bind UI offers): cities for Tunisia, dexpress_states for Libya.
// ---------------------------------------------------------------------------
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

  test("Tunisia: returns the market's cities", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const citiesChain = chain({
      data: [{ id: "city-tunis", name: "Tunis", name_ar: "تونس" }],
    });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(citiesChain);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    // scoped to the target market, never touches dexpress_states
    const calls = citiesChain.__calls as Array<{ method: string; args: unknown[] }>;
    expect(calls).toContainEqual({ method: "eq", args: ["market_id", TN_MARKET_ID] });
    expect(mockFrom.mock.calls.map((c) => c[0])).not.toContain("dexpress_states");
  });

  test("Libya: returns active Dexpress states", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    const statesChain = chain({ data: [{ id: 16, name: "اجدابيا" }] });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }))
      .mockReturnValueOnce(statesChain);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
    expect(mockFrom.mock.calls.map((c) => c[0])).toContain("dexpress_states");
    expect(mockFrom.mock.calls.map((c) => c[0])).not.toContain("cities");
  });
});

// ---------------------------------------------------------------------------
// POST — binds one order directly to an existing destination. No alias table.
// ---------------------------------------------------------------------------
describe("POST /api/mappings/cities", () => {
  test("agent is forbidden", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "a-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "agent", market_id: TN_MARKET_ID } }));
    const res = await POST(postReq({ order_id: "o-1", city_id: "c-1" }));
    expect(res.status).toBe(403);
  });

  test("rejects missing order_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }));
    const res = await POST(postReq({ city_id: "c-1" }));
    expect(res.status).toBe(400);
  });

  test("rejects when neither city_id nor dexpress_state_id is given", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }));
    const res = await POST(postReq({ order_id: "o-1" }));
    expect(res.status).toBe(400);
  });

  test("404 when the order does not exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(chain({ data: null })); // order lookup miss
    const res = await POST(postReq({ order_id: "o-x", city_id: "c-1" }));
    expect(res.status).toBe(404);
  });

  test("forbids binding an order in another market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-1", market_id: LY_MARKET_ID, product_id: "p-1", status: "pending" } }),
      );
    const res = await POST(postReq({ order_id: "o-1", city_id: "c-1" }));
    expect(res.status).toBe(403);
  });

  test("rejects binding an order that is already confirmed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-1", market_id: TN_MARKET_ID, product_id: "p-1", status: "confirmed" } }),
      );
    const res = await POST(postReq({ order_id: "o-1", city_id: "c-1" }));
    expect(res.status).toBe(409);
  });

  // --- Tunisia path --------------------------------------------------------

  test("Tunisia: binds order.city_id and recomputes mapping_status (product set -> mapped)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const updateChain = chain({ data: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-1", market_id: TN_MARKET_ID, product_id: "p-1", status: "pending" } }),
      ) // order lookup
      .mockReturnValueOnce(chain({ data: { id: "c-1", market_id: TN_MARKET_ID } })) // city lookup
      .mockReturnValueOnce(updateChain); // update order

    const res = await POST(postReq({ order_id: "o-1", city_id: "c-1" }));
    expect(res.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        city_id: "c-1",
        dexpress_state_id: null,
        mapping_status: "mapped",
      }),
    );
  });

  test("Tunisia: product still unresolved -> mapping_status needs_review", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    const updateChain = chain({ data: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-1", market_id: TN_MARKET_ID, product_id: null, status: "pending" } }),
      )
      .mockReturnValueOnce(chain({ data: { id: "c-1", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(updateChain);

    const res = await POST(postReq({ order_id: "o-1", city_id: "c-1" }));
    expect(res.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ mapping_status: "needs_review" }),
    );
  });

  test("Tunisia: 404 when the city does not exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-1", market_id: TN_MARKET_ID, product_id: "p-1", status: "pending" } }),
      )
      .mockReturnValueOnce(chain({ data: null })); // city miss
    const res = await POST(postReq({ order_id: "o-1", city_id: "c-x" }));
    expect(res.status).toBe(404);
  });

  test("Tunisia: rejects a city in another market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: TN_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-1", market_id: TN_MARKET_ID, product_id: "p-1", status: "pending" } }),
      )
      .mockReturnValueOnce(chain({ data: { id: "c-ly", market_id: LY_MARKET_ID } }));
    const res = await POST(postReq({ order_id: "o-1", city_id: "c-ly" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not in the target market/i);
  });

  // --- Libya path ----------------------------------------------------------

  test("Libya: binds order.dexpress_state_id, clears city_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    const updateChain = chain({ data: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-ly", market_id: LY_MARKET_ID, product_id: null, status: "pending" } }),
      )
      .mockReturnValueOnce(chain({ data: { id: 16 } })) // dexpress_states lookup
      .mockReturnValueOnce(updateChain);

    const res = await POST(postReq({ order_id: "o-ly", dexpress_state_id: 16 }));
    expect(res.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        dexpress_state_id: 16,
        city_id: null,
        mapping_status: "needs_review",
      }),
    );
  });

  test("Libya: 404 when the Dexpress state does not exist", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-ly", market_id: LY_MARKET_ID, product_id: null, status: "pending" } }),
      )
      .mockReturnValueOnce(chain({ data: null })); // dexpress miss
    const res = await POST(postReq({ order_id: "o-ly", dexpress_state_id: 99999 }));
    expect(res.status).toBe(404);
  });

  test("Libya: rejects a city_id for a Dexpress-market order (wrong destination kind)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-ly" } } });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "market_manager", market_id: LY_MARKET_ID } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-ly", market_id: LY_MARKET_ID, product_id: null, status: "pending" } }),
      );
    const res = await POST(postReq({ order_id: "o-ly", city_id: "c-1" }));
    expect(res.status).toBe(400);
  });

  test("super_admin can bind an order in any market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const updateChain = chain({ data: null });
    mockFrom
      .mockReturnValueOnce(chain({ data: { role: "super_admin", market_id: null } }))
      .mockReturnValueOnce(
        chain({ data: { id: "o-ly", market_id: LY_MARKET_ID, product_id: "p-1", status: "pending" } }),
      )
      .mockReturnValueOnce(chain({ data: { id: 16 } }))
      .mockReturnValueOnce(updateChain);

    const res = await POST(postReq({ order_id: "o-ly", dexpress_state_id: 16 }));
    expect(res.status).toBe(200);
    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ dexpress_state_id: 16, mapping_status: "mapped" }),
    );
  });
});
