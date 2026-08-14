import { describe, test, expect, vi, beforeEach } from "vitest";

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

function getRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/ad-spend");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url);
}

function postRequest(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new NextRequest(new URL("http://localhost:3000/api/ad-spend"), {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function userChain(role: string, marketId: string | null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue({ data: { role, market_id: marketId }, error: null });
  return chain;
}

// PostgREST caps an un-ranged response at 1000 rows and reports no error when
// it does — the array is simply shorter. The mock reproduces that, so a test
// written against a >1000-row fixture fails for an unpaged read exactly the way
// production would silently under-report.
const POSTGREST_CAP = 1000;

function thenableChain(payload: { data?: unknown; error?: unknown }) {
  const resolved = { data: payload.data ?? null, error: payload.error ?? null };
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const m of ["select", "eq", "is", "not", "gte", "lte", "order", "insert", "update"]) {
    chain[m] = vi.fn().mockImplementation(passthrough);
  }
  chain.single = vi.fn().mockResolvedValue(resolved);
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
    const capped = Array.isArray(resolved.data)
      ? { ...resolved, data: resolved.data.slice(0, POSTGREST_CAP) }
      : resolved;
    return Promise.resolve(capped).then(res, rej);
  };
  // fetchAllRows pages with .range(from, to), inclusive on both ends the way
  // PostgREST is. Slicing the fixture is what lets a >1000-row case exercise
  // the second page instead of stopping at the cap.
  chain.range = vi.fn().mockImplementation((from: number, to: number) => {
    const all = Array.isArray(resolved.data) ? resolved.data : [];
    return Promise.resolve({ data: all.slice(from, to + 1), error: resolved.error });
  });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// Period ending 2+ quarters ago is locked (period-lock.ts). Anything in the
// current quarter is open.
const LOCKED_END = "2025-01-31";
const openPeriod = () => {
  const d = new Date();
  const iso = d.toISOString().slice(0, 10);
  return { start: iso.slice(0, 8) + "01", end: iso };
};

describe("GET /api/ad-spend", () => {
  test("403 for market_manager (finance section is super_admin only)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("market_manager", "m-1") : thenableChain({ data: [] }),
    );
    const res = await GET(getRequest({ market_id: "m-1" }));
    expect(res.status).toBe(403);
  });

  test("400 for super_admin without market_id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : thenableChain({ data: [] }),
    );
    const res = await GET(getRequest());
    expect(res.status).toBe(400);
  });

  test("200 with entries for super_admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : thenableChain({
            data: [
              {
                id: "e1",
                market_id: "m-1",
                product_id: null,
                amount: 100,
                period_start: "2026-07-01",
                period_end: "2026-07-07",
                note: null,
              },
            ],
          }),
    );
    const res = await GET(getRequest({ market_id: "m-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
  });

  // Daily campaign rows take a single market past PostgREST's 1000-row cap in
  // about a hundred days. The cap is not an error — it is a shorter array — so
  // an unpaged read would understate every rollup this page renders.
  test("returns every entry past the 1000-row PostgREST cap", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    const manyEntries = Array.from({ length: 1500 }, (_, i) => ({
      id: `e${i}`,
      market_id: "m-1",
      product_id: null,
      amount: 1,
      period_start: "2026-07-01",
      period_end: "2026-07-01",
      note: null,
    }));
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : thenableChain({ data: manyEntries }),
    );
    const res = await GET(getRequest({ market_id: "m-1" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1500);
  });
});

describe("POST /api/ad-spend — period lock on create", () => {
  test("403 for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("market_manager", "m-1") : thenableChain({}),
    );
    const p = openPeriod();
    const res = await POST(postRequest({ amount: 50, period_start: p.start, period_end: p.end }));
    expect(res.status).toBe(403);
  });

  test("409 for super_admin inserting into a locked period without confirmation header", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users" ? userChain("super_admin", null) : thenableChain({}),
    );
    const res = await POST(
      postRequest({ amount: 50, period_start: "2025-01-01", period_end: LOCKED_END, market_id: "m-1" }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toBe("period_locked_confirmation_required");
  });

  test("201 for super_admin inserting into a locked period WITH confirmation header", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : thenableChain({ data: { id: "new-entry" } }),
    );
    const res = await POST(
      postRequest(
        { amount: 50, period_start: "2025-01-01", period_end: LOCKED_END, market_id: "m-1" },
        { "x-confirm-locked-period": "true" },
      ),
    );
    expect(res.status).toBe(201);
  });

  test("201 for super_admin in an open period", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "admin-1" } }, error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "users"
        ? userChain("super_admin", null)
        : thenableChain({ data: { id: "new-entry" } }),
    );
    const p = openPeriod();
    const res = await POST(
      postRequest({ amount: 50, period_start: p.start, period_end: p.end, market_id: "m-1" }),
    );
    expect(res.status).toBe(201);
  });
});
