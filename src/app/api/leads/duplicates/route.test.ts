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

function req(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" });
}

function queryChain(resolveWith: { data: unknown; error: unknown }) {
  // A single chain object that's returned by every method and is also thenable,
  // so `await chain` resolves with `resolveWith` at any point in the chain.
  const chain: Record<string, unknown> = {};
  const then = (onFulfilled: (v: typeof resolveWith) => unknown) =>
    Promise.resolve(resolveWith).then(onFulfilled);
  chain.then = then;
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.neq = vi.fn().mockReturnValue(chain);
  chain.ilike = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/leads/duplicates", () => {
  test("returns 401 without auth", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req("/api/leads/duplicates?phone=22333444&market_id=m1"));
    expect(res.status).toBe(401);
  });

  test("returns 400 when phone is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(
      queryChain({ data: { role: "market_manager", market_id: "m1" }, error: null })
    );
    const res = await GET(req("/api/leads/duplicates?market_id=m1"));
    expect(res.status).toBe(400);
  });

  test("returns 200 with empty array when no duplicates", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      }
      return queryChain({ data: [], error: null });
    });
    const res = await GET(req("/api/leads/duplicates?phone=22333444&market_id=m1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([]);
  });

  test("returns 200 with matching leads", async () => {
    const match = { id: "l1", customer_name: "Ali", status: "qualified", market_id: "m1" };
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({ data: { role: "market_manager", market_id: "m1" }, error: null });
      }
      return queryChain({ data: [match], error: null });
    });
    const res = await GET(req("/api/leads/duplicates?phone=22333444&market_id=m1"));
    const json = await res.json();
    expect(json.data).toEqual([match]);
  });

  test("returns 403 when market_manager accesses different market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(
      queryChain({ data: { role: "market_manager", market_id: "m1" }, error: null })
    );
    const res = await GET(req("/api/leads/duplicates?phone=22333444&market_id=m2"));
    expect(res.status).toBe(403);
  });
});
