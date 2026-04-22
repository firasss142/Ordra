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

const req = (url = "/api/leads/metrics") =>
  new NextRequest(new URL(url, "http://localhost:3000"));

function userChain(data: unknown) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error: null });
  return c;
}

function leadsChain(data: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.gte = vi.fn().mockReturnValue(c);
  c.lte = vi.fn().mockReturnValue(c);
  c.limit = vi.fn().mockReturnValue(c);
  // terminal resolution — just awaiting the builder resolves
  return Object.assign(c, {
    then(resolve: (r: { data: unknown[]; error: null }) => void) {
      resolve({ data, error: null });
    },
  });
}

function agentsChain(data: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.in = vi.fn().mockResolvedValue({ data, error: null });
  return c;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/leads/metrics", () => {
  test("403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain({ role: "agent", market_id: "m1" });
      return userChain(null);
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  test("computes overall + per-agent + per-source + lost reasons", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });

    const rows = [
      { status: "won", source: "manual_call", assigned_to: "a1", lost_reason: null },
      { status: "won", source: "manual_call", assigned_to: "a1", lost_reason: null },
      { status: "lost", source: "facebook_comment", assigned_to: "a2", lost_reason: "price" },
      { status: "lost", source: "manual_call", assigned_to: "a1", lost_reason: "unreachable" },
      { status: "attempt_1", source: "manual_call", assigned_to: "a1", lost_reason: null },
    ];

    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return userChain({ role: "market_manager", market_id: "m1" });
      if (t === "leads") return leadsChain(rows);
      return userChain(null);
    });

    // Override the second users() call (for agent name lookup) — that needs .in()
    let callCount = 0;
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") {
        callCount++;
        if (callCount === 1) return userChain({ role: "market_manager", market_id: "m1" });
        return agentsChain([
          { id: "a1", full_name: "Alice" },
          { id: "a2", full_name: "Bob" },
        ]);
      }
      if (t === "leads") return leadsChain(rows);
      return userChain(null);
    });

    const res = await GET(req());
    expect(res.status).toBe(200);
    const json = await res.json();
    const m = json.data;

    expect(m.total).toBe(5);
    expect(m.won).toBe(2);
    expect(m.lost).toBe(2);
    expect(m.overallConversionRate).toBe(0.5);

    const a1 = m.byAgent.find((a: { agentId: string }) => a.agentId === "a1");
    expect(a1.agentName).toBe("Alice");
    expect(a1.won).toBe(2);
    expect(a1.lost).toBe(1);

    const manual = m.bySource.find((s: { source: string }) => s.source === "manual_call");
    expect(manual.won).toBe(2);
    expect(manual.lost).toBe(1);

    const priceReason = m.lostReasons.find((r: { reason: string }) => r.reason === "price");
    expect(priceReason.count).toBe(1);
  });
});
