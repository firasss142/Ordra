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

function createRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/orders/unassigned/count");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

function queryChain(resolveWith: { data: unknown; error: unknown; count?: number | null }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.is = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: resolveWith.data, error: resolveWith.error, count: resolveWith.count ?? null });
  // For count queries that don't call .single()
  chain.then = undefined;
  // Make the chain itself thenable so awaiting it resolves
  const resolved = { data: resolveWith.data, error: resolveWith.error, count: resolveWith.count ?? null };
  chain.eq = vi.fn().mockImplementation(() => {
    const inner: Record<string, unknown> = {};
    inner.eq = vi.fn().mockReturnValue(inner);
    inner.is = vi.fn().mockReturnValue(inner);
    // Resolve when awaited
    Object.defineProperty(inner, Symbol.toStringTag, { value: "Promise" });
    inner.then = (resolve: (v: unknown) => void) => Promise.resolve(resolved).then(resolve);
    inner.catch = (reject: (e: unknown) => void) => Promise.resolve(resolved).catch(reject);
    return inner;
  });
  chain.is = vi.fn().mockReturnValue(chain);
  return chain;
}

function makeCountChain(count: number | null, error: unknown = null) {
  const resolved = { data: null, error, count };
  // Build a lazy step: each method returns `this` but the chain resolves when awaited
  const makeStep = () => {
    const step: Record<string, unknown> = {};
    step.eq = vi.fn().mockReturnThis();
    step.is = vi.fn().mockReturnThis();
    step.then = (
      resolve: (v: typeof resolved) => unknown,
      reject?: (e: unknown) => unknown
    ) => Promise.resolve(resolved).then(resolve, reject);
    step.catch = (reject: (e: unknown) => unknown) =>
      Promise.resolve(resolved).catch(reject);
    return step;
  };
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(makeStep());
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/orders/unassigned/count", () => {
  test("returns 401 when no session", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(createRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    const usersChain: Record<string, unknown> = {};
    usersChain.select = vi.fn().mockReturnValue(usersChain);
    usersChain.eq = vi.fn().mockReturnValue(usersChain);
    usersChain.single = vi.fn().mockResolvedValue({ data: { role: "agent", market_id: "m-1" }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain;
      return makeCountChain(5);
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(403);
  });

  test("returns { count: N } for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    const usersChain: Record<string, unknown> = {};
    usersChain.select = vi.fn().mockReturnValue(usersChain);
    usersChain.eq = vi.fn().mockReturnValue(usersChain);
    usersChain.single = vi.fn().mockResolvedValue({ data: { role: "market_manager", market_id: "m-1" }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain;
      return makeCountChain(7);
    });

    const res = await GET(createRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.count).toBe(7);
  });
});
