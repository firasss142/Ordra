import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(
    new URL("/api/leads/lead-1/callback", "http://localhost:3000"),
    { method: "POST", body: JSON.stringify(body) } as any
  );
}

function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.update = vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) });
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

const params = { params: Promise.resolve({ id: "lead-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/leads/[id]/callback", () => {
  test("400 without callback_time", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) =>
      t === "users" ? chain({ role: "agent", market_id: "m1" }) : chain(null)
    );
    const res = await POST(req({}), params);
    expect(res.status).toBe(400);
  });

  test("400 when callback_time is in the past", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) =>
      t === "users" ? chain({ role: "agent", market_id: "m1" }) : chain(null)
    );
    const past = new Date(Date.now() - 60_000).toISOString();
    const res = await POST(req({ callback_time: past }), params);
    expect(res.status).toBe(400);
  });

  test("200 schedules callback, updates column, writes history via RPC", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });

    let leadsChain: ReturnType<typeof chain>;
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads") {
        leadsChain = chain({
          id: "lead-1",
          status: "attempt_1",
          assigned_to: "agent-1",
        });
        return leadsChain;
      }
      return chain(null);
    });
    mockRpc.mockResolvedValue({ data: null, error: null });

    const res = await POST(req({ callback_time: future }), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "transition_lead_status",
      expect.objectContaining({ p_new_status: "callback_scheduled" })
    );
  });

  test("agent 404 for lead assigned elsewhere", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads")
        return chain({ id: "lead-1", status: "attempt_1", assigned_to: "agent-2" });
      return chain(null);
    });

    const res = await POST(req({ callback_time: future }), params);
    expect(res.status).toBe(404);
  });
});
