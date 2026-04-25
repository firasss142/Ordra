import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET, PUT } from "./route";
import { NextRequest } from "next/server";

function getRequest(params: Record<string, string> = {}) {
  const url = new URL("http://localhost:3000/api/assignment-rules");
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  return new NextRequest(url, { method: "GET" });
}

function putRequest(body: unknown) {
  return new NextRequest("http://localhost:3000/api/assignment-rules", {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function resolvable(resolved: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  const methods = ["select", "eq", "in", "upsert"];
  for (const m of methods) c[m] = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn().mockResolvedValue(resolved);
  c.single = vi.fn().mockResolvedValue(resolved);
  (c as { then: unknown }).then = (r: (v: unknown) => void) =>
    Promise.resolve(r(resolved));
  return c;
}

const MANAGER = { role: "market_manager", market_id: "m-tn" };
const AGENT_ACTOR = { role: "agent", market_id: "m-tn" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/assignment-rules", () => {
  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockImplementation(() => resolvable({ data: AGENT_ACTOR, error: null }));
    const res = await GET(getRequest());
    expect(res.status).toBe(403);
  });

  test("returns existing rule for market_manager", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    let usersCall = 0;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        usersCall += 1;
        return resolvable({ data: MANAGER, error: null });
      }
      if (table === "assignment_rules") {
        return resolvable({
          data: { algorithm: "workload", config: { last_assigned_index: 3 }, is_active: true },
          error: null,
        });
      }
      return resolvable({ data: [], error: null });
    });
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.algorithm).toBe("workload");
    expect(json.data.is_active).toBe(true);
    expect(usersCall).toBeGreaterThan(0);
  });

  test("returns default rule when none exists in DB", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return resolvable({ data: MANAGER, error: null });
      return resolvable({ data: null, error: null });
    });
    const res = await GET(getRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.algorithm).toBe("manual");
    expect(json.data.is_active).toBe(false);
  });
});

describe("PUT /api/assignment-rules", () => {
  test("rejects invalid algorithm", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mockFrom.mockImplementation(() => resolvable({ data: MANAGER, error: null }));
    const res = await PUT(putRequest({ algorithm: "nonsense" }));
    expect(res.status).toBe(400);
  });

  test("upserts rule + syncs settings on valid algorithm", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });

    const upsertCalls: Array<{ table: string; payload: unknown }> = [];
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return resolvable({ data: MANAGER, error: null });

      const c: Record<string, unknown> = {};
      c.upsert = vi.fn().mockImplementation((payload: unknown) => {
        upsertCalls.push({ table, payload });
        return c;
      });
      c.select = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({
        data: { algorithm: "round_robin", config: null, is_active: true },
        error: null,
      });
      (c as { then: unknown }).then = (r: (v: unknown) => void) =>
        Promise.resolve(r({ data: null, error: null }));
      return c;
    });

    const res = await PUT(putRequest({ algorithm: "round_robin", is_active: true }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.algorithm).toBe("round_robin");
    expect(upsertCalls.find((c) => c.table === "assignment_rules")).toBeDefined();
    expect(upsertCalls.find((c) => c.table === "settings")).toBeDefined();
  });
});
