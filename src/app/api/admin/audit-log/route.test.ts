import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  })),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";

function makeRequest(query: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/admin/audit-log");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return new NextRequest(url, { method: "GET" });
}

function userChain(role: string, market_id: string | null = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: { role, market_id }, error: null });
  return c;
}

function auditChain(rows: unknown[] = []) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.range = vi.fn().mockResolvedValue({ data: rows, error: null });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/admin/audit-log", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  test("returns 401 when actor not found in users table", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.single = vi.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
    mockFrom.mockReturnValue(c);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  test("returns 403 for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(userChain("market_manager", "market-1"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  test("returns 403 for agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(userChain("agent", "market-1"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  test("returns 403 for warehouse_agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(userChain("warehouse_agent", "market-1"));
    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
  });

  test("returns 200 with data array for super_admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(userChain("super_admin"));
    const rows = [{ id: "e1", event_type: "user_created", created_at: "2026-01-01T00:00:00Z" }];
    mockAdminFrom.mockReturnValue(auditChain(rows));
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe("e1");
  });

  test("passes target_id filter to query when provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(userChain("super_admin"));
    const chain = auditChain([]);
    mockAdminFrom.mockReturnValue(chain);
    await GET(makeRequest({ target_id: "target-user-1" }));
    expect(chain.eq).toHaveBeenCalledWith("target_id", "target-user-1");
  });

  test("default limit is 50 (range 0..49)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(userChain("super_admin"));
    const chain = auditChain([]);
    mockAdminFrom.mockReturnValue(chain);
    await GET(makeRequest());
    expect(chain.range).toHaveBeenCalledWith(0, 49);
  });

  test("custom limit capped at 100 (range 0..99)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(userChain("super_admin"));
    const chain = auditChain([]);
    mockAdminFrom.mockReturnValue(chain);
    await GET(makeRequest({ limit: "200" }));
    expect(chain.range).toHaveBeenCalledWith(0, 99);
  });

  test("custom limit within bounds is respected", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockReturnValue(userChain("super_admin"));
    const chain = auditChain([]);
    mockAdminFrom.mockReturnValue(chain);
    await GET(makeRequest({ limit: "20", offset: "40" }));
    expect(chain.range).toHaveBeenCalledWith(40, 59);
  });
});
