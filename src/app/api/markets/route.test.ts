import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("next/cache", () => ({
  unstable_cache: <T extends (...args: unknown[]) => unknown>(fn: T) => fn,
  revalidateTag: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: () => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}));

import { GET } from "./route";

function makeReq() {
  return new NextRequest("http://localhost/api/markets");
}

function usersChain(role: string, market_id: string | null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return c;
}

function marketsChain(markets: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data: markets, error: null });
  return c;
}

const ALL_MARKETS = [
  { id: "m-1", name: "Tunisia", code: "tn" },
  { id: "m-2", name: "Libya", code: "ly" },
];

beforeEach(() => vi.clearAllMocks());

describe("GET /api/markets", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(makeReq());
    expect(res.status).toBe(401);
  });

  test("super_admin gets all markets", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom.mockImplementation(() => usersChain("super_admin", null));
    mockAdminFrom.mockImplementation(() => marketsChain(ALL_MARKETS));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
  });

  test("market_manager gets only their own market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockImplementation(() => usersChain("market_manager", "m-1"));
    mockAdminFrom.mockImplementation(() => marketsChain(ALL_MARKETS));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("m-1");
  });

  test("agent sees only their own market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "ag-1" } } });
    mockFrom.mockImplementation(() => usersChain("agent", "m-1"));
    mockAdminFrom.mockImplementation(() => marketsChain(ALL_MARKETS));
    const res = await GET(makeReq());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(1);
    expect(json.data[0].id).toBe("m-1");
  });

  test("agent without market_id gets 403", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "ag-1" } } });
    mockFrom.mockImplementation(() => usersChain("agent", null));
    const res = await GET(makeReq());
    expect(res.status).toBe(403);
  });
});

/**
 * Réglages › Marchés lists every market — an inactive one too, or it could
 * never be switched back on — with its label sender. super_admin only.
 */
describe("GET /api/markets?detail=1", () => {
  function detailChain(rows: unknown[]) {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.order = vi.fn().mockResolvedValue({ data: rows, error: null });
    return c;
  }

  test("super_admin gets every market, inactive included, with the label sender", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    const rows = [
      { id: "m-2", code: "ly", name: "Libya", language: "ar", currency: "LYD", direction: "rtl", is_active: true, sender_name: "Libya", sender_address: null, sender_phone: null },
      { id: "m-1", code: "tn", name: "Tunisia", language: "fr", currency: "TND", direction: "ltr", is_active: false, sender_name: "Tunisia", sender_address: null, sender_phone: null },
    ];
    let chain: Record<string, unknown> | null = null;
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) return usersChain("super_admin", null);
      chain = detailChain(rows);
      return chain;
    });
    const res = await GET(new NextRequest("http://localhost/api/markets?detail=1"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toHaveLength(2);
    expect(json.data[1].is_active).toBe(false);
    const c = chain as unknown as { select: ReturnType<typeof vi.fn> };
    expect(String(c.select.mock.calls[0][0])).toContain("sender_phone");
  });

  test("a market manager is refused the detailed list", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockImplementation(() => usersChain("market_manager", "m-1"));
    const res = await GET(new NextRequest("http://localhost/api/markets?detail=1"));
    expect(res.status).toBe(403);
  });
});
