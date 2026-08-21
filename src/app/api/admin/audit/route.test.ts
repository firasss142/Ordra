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
  return new NextRequest(new URL("http://localhost/api/admin/audit"));
}

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

describe("GET /api/admin/audit", () => {
  test("403 for non super_admin", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm" } } });
    mockFrom.mockImplementation(() => usersChain("market_manager"));
    expect((await GET(req())).status).toBe(403);
  });

  test("merges settings_history and user_audit_log into one time-ordered feed", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain("super_admin");
      if (table === "settings_history")
        return tableChain([
          { id: "sh1", key: "max_call_attempts", old_value: { value: 3 }, new_value: { value: 9 }, changed_at: "2026-08-21T14:00:00Z", changed_by: "u1", users: { full_name: "Admin" } },
        ]);
      if (table === "user_audit_log")
        return tableChain([
          { id: "ua1", event_type: "deactivate", meta: {}, created_at: "2026-08-21T15:00:00Z", actor_id: "u1", target_id: "u2", actor: { full_name: "Admin" }, target: { full_name: "Agent X" } },
        ]);
      return tableChain([]);
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const rows = (await res.json()).data as Array<{ id: string; kind: string; at: string; summary: string }>;
    // newest first: user_audit(15:00) then settings(14:00)
    expect(rows.map((r) => r.id)).toEqual(["ua1", "sh1"]);
    expect(rows.find((r) => r.id === "sh1")?.kind).toBe("settings");
    expect(rows.find((r) => r.id === "ua1")?.kind).toBe("user");
    // settings row summarises the key + change
    expect(rows.find((r) => r.id === "sh1")?.summary).toMatch(/max_call_attempts/);
  });

  test("tolerates one table erroring", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "sa" } } });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain("super_admin");
      if (table === "user_audit_log") {
        const c: Record<string, unknown> = {};
        c.select = vi.fn().mockReturnValue(c);
        c.order = vi.fn().mockReturnValue(c);
        c.limit = vi.fn().mockResolvedValue({ data: null, error: { message: "x" } });
        return c;
      }
      if (table === "settings_history")
        return tableChain([{ id: "sh1", key: "sla_minutes", old_value: { value: 120 }, new_value: { value: 90 }, changed_at: "2026-08-21T14:00:00Z", changed_by: "u1", users: { full_name: "Admin" } }]);
      return tableChain([]);
    });
    const rows = (await (await GET(req())).json()).data as Array<{ id: string }>;
    expect(rows.map((r) => r.id)).toEqual(["sh1"]);
  });
});
