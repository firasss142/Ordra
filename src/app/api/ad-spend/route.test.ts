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

function thenableChain(payload: { data?: unknown; error?: unknown }) {
  const resolved = { data: payload.data ?? null, error: payload.error ?? null };
  const chain: Record<string, unknown> = {};
  const passthrough = () => chain;
  for (const m of ["select", "eq", "is", "not", "gte", "lte", "order", "insert", "update"]) {
    chain[m] = vi.fn().mockImplementation(passthrough);
  }
  chain.single = vi.fn().mockResolvedValue(resolved);
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
    Promise.resolve(resolved).then(res, rej);
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
