import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET } from "./route";

function req() {
  return new NextRequest(new URL("http://localhost/api/admin/sync-runs"));
}

/** A per-table chain whose terminal .limit() resolves with rows. */
function tableChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockResolvedValue({ data: rows, error: null });
  return c;
}

function usersChain(role: string) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: { role, market_id: null }, error: null });
  return c;
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/admin/sync-runs", () => {
  test("403 for non super_admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm" } } });
    mockFrom.mockImplementation(() => usersChain("market_manager"));
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  test("unions all sync-run tables, labels source, sorts by started_at desc", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain("super_admin");
      if (table === "sheet_sync_runs")
        return tableChain([{ id: "s1", started_at: "2026-08-21T10:00:00Z", finished_at: null, status: "succeeded", trigger: "cron" }]);
      if (table === "ad_sync_runs")
        return tableChain([{ id: "a1", started_at: "2026-08-21T12:00:00Z", finished_at: null, status: "succeeded", trigger: "cron" }]);
      if (table === "darb_sync_runs")
        return tableChain([{ id: "d1", started_at: "2026-08-21T11:00:00Z", finished_at: null, status: "running", trigger: "cron", error_message: null }]);
      if (table === "darb_rate_harvest_runs")
        return tableChain([{ id: "r1", started_at: "2026-08-21T03:00:00Z", finished_at: null, status: "completed", trigger: "cron" }]);
      return tableChain([]);
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    const rows = body.data as Array<{ id: string; source: string; started_at: string }>;
    // 4 rows total, newest first: ad(12:00) darb(11:00) sheet(10:00) rate(03:00)
    expect(rows.map((r) => r.id)).toEqual(["a1", "d1", "s1", "r1"]);
    // each row carries a human source label
    expect(rows.find((r) => r.id === "a1")?.source).toMatch(/Meta/i);
    expect(rows.find((r) => r.id === "s1")?.source).toMatch(/Sheets/i);
    expect(rows.find((r) => r.id === "d1")?.source).toMatch(/Darb/i);
  });

  test("tolerates a table returning an error (skips it, still returns others)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain("super_admin");
      if (table === "ad_sync_runs") {
        const c: Record<string, unknown> = {};
        c.select = vi.fn().mockReturnValue(c);
        c.order = vi.fn().mockReturnValue(c);
        c.limit = vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } });
        return c;
      }
      if (table === "sheet_sync_runs")
        return tableChain([{ id: "s1", started_at: "2026-08-21T10:00:00Z", finished_at: null, status: "succeeded", trigger: "cron" }]);
      return tableChain([]);
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const rows = (await res.json()).data as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toContain("s1");
  });
});
