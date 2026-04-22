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

const req = () =>
  new NextRequest(new URL("/api/agent/leads/queue", "http://localhost:3000"));

function activeResChain(data: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockResolvedValue({ data, error: null });
  return c;
}

function closedResChain(data: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockReturnValue(c);
  c.gte = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data, error: null });
  return c;
}

function userChain(data: unknown) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error: null });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/agent/leads/queue", () => {
  test("403 for non-agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) =>
      t === "users" ? userChain({ role: "market_manager", market_id: "m1" }) : activeResChain([])
    );
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  test("returns sorted active leads and bucket counts", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    const active = [
      {
        id: "a",
        status: "assigned",
        callback_scheduled_at: null,
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "b",
        status: "attempt_2",
        callback_scheduled_at: null,
        created_at: "2026-01-02T00:00:00Z",
      },
      {
        id: "c",
        status: "qualified",
        callback_scheduled_at: null,
        created_at: "2026-01-03T00:00:00Z",
      },
    ];

    let callCount = 0;
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain({ role: "agent", market_id: "m1" });
      if (t === "leads") {
        callCount++;
        return callCount === 1 ? activeResChain(active) : closedResChain([]);
      }
      return userChain(null);
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.buckets.nouveau).toBe(1);
    expect(json.buckets.tentative_2).toBe(1);
    expect(json.buckets.qualifie).toBe(1);
    expect(json.leads.map((l: { id: string }) => l.id)).toEqual(["b", "a", "c"]);
  });
});
