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

function req() {
  return new NextRequest(
    new URL("http://localhost/api/warehouse/returns/summary"),
  );
}

function profileChain(profile: unknown) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: profile, error: null });
  return c;
}

function countChain(count: number | null, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.gte = vi.fn().mockReturnValue(c);
  // lt is the terminal call — always resolves
  c.lt = vi.fn().mockResolvedValue({ count, error });
  return c;
}

function profileChainStrict(profile: unknown) {
  return profileChain(profile);
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/warehouse/returns/summary — auth", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const res = await GET(req());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    mockFrom.mockReturnValue(profileChain({ role: "agent", market_id: "m-1" }));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });
});

describe("GET /api/warehouse/returns/summary — success", () => {
  test("returns scanned_today and damaged_today counts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    const counts = [5, 2];
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return profileChain({ role: "warehouse_agent", market_id: "m-1" });
      return countChain(counts[callCount++] ?? 0);
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    // scanned_today + damaged_today should sum to 7
    expect(json.scanned_today + json.damaged_today).toBe(7);
  });

  test("returns zeros when no rows exist today", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return profileChain({ role: "warehouse_agent", market_id: "m-1" });
      return countChain(null);
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.scanned_today).toBe(0);
    expect(json.damaged_today).toBe(0);
  });

  test("returns 500 on DB error for scanned query", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    let callCount = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return profileChain({ role: "warehouse_agent", market_id: "m-1" });
      callCount++;
      // Both queries run in Promise.all — either one erroring should cause 500
      return countChain(null, { message: "db error" });
    });

    const res = await GET(req());
    expect(res.status).toBe(500);
    // suppress unused warning
    expect(callCount).toBeGreaterThan(0);
  });

  test("market_manager can access summary", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return profileChain({ role: "market_manager", market_id: "m-1" });
      return countChain(3);
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
  });

  test("super_admin can access summary", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa-1" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return profileChain({ role: "super_admin", market_id: null });
      return countChain(10);
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
  });
});
