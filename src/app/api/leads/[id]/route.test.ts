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

import { GET, PATCH, DELETE } from "./route";
import { NextRequest } from "next/server";

function req(method: string, url: string, body?: unknown) {
  const init: Record<string, unknown> = { method };
  if (body) init.body = JSON.stringify(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, "http://localhost:3000"), init as any);
}

function chain(resolveWith: { data: unknown; error: unknown }) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.order = vi.fn().mockResolvedValue({ data: [], error: null });
  c.single = vi.fn().mockResolvedValue(resolveWith);
  c.update = vi.fn().mockReturnValue(c);
  c.insert = vi.fn().mockReturnValue(c);
  return c;
}

const params = { params: Promise.resolve({ id: "lead-1" }) };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/leads/[id]", () => {
  test("404 when lead not found", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({
          data: { role: "market_manager", market_id: "m1" },
          error: null,
        });
      if (t === "leads") return chain({ data: null, error: { message: "not found" } });
      return chain({ data: null, error: null });
    });

    const res = await GET(req("GET", "/api/leads/lead-1"), params);
    expect(res.status).toBe(404);
  });

  test("403 when manager queries lead outside own market", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({
          data: { role: "market_manager", market_id: "m1" },
          error: null,
        });
      if (t === "leads")
        return chain({
          data: { id: "lead-1", market_id: "m2", assigned_to: null, status: "new" },
          error: null,
        });
      return chain({ data: null, error: null });
    });

    const res = await GET(req("GET", "/api/leads/lead-1"), params);
    expect(res.status).toBe(403);
  });

  test("agent sees own assigned lead with history", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({ data: { role: "agent", market_id: "m1" }, error: null });
      if (t === "leads")
        return chain({
          data: {
            id: "lead-1",
            market_id: "m1",
            assigned_to: "agent-1",
            status: "attempt_1",
          },
          error: null,
        });
      if (t === "lead_history") {
        const c = chain({ data: null, error: null });
        c.order = vi
          .fn()
          .mockResolvedValue({
            data: [{ id: "h1", lead_id: "lead-1", status_to: "attempt_1" }],
            error: null,
          });
        return c;
      }
      return chain({ data: null, error: null });
    });

    const res = await GET(req("GET", "/api/leads/lead-1"), params);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.history).toHaveLength(1);
  });

  test("agent gets 404 for lead assigned to someone else", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({ data: { role: "agent", market_id: "m1" }, error: null });
      if (t === "leads")
        return chain({
          data: {
            id: "lead-1",
            market_id: "m1",
            assigned_to: "agent-2",
            status: "attempt_1",
          },
          error: null,
        });
      return chain({ data: null, error: null });
    });

    const res = await GET(req("GET", "/api/leads/lead-1"), params);
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/leads/[id]", () => {
  test("409 on terminal lead", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({
          data: { role: "market_manager", market_id: "m1" },
          error: null,
        });
      if (t === "leads")
        return chain({
          data: {
            id: "lead-1",
            market_id: "m1",
            assigned_to: null,
            status: "won",
          },
          error: null,
        });
      return chain({ data: null, error: null });
    });

    const res = await PATCH(
      req("PATCH", "/api/leads/lead-1", { customer_name: "X" }),
      params
    );
    expect(res.status).toBe(409);
  });

  test("400 when no editable fields provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({
          data: { role: "market_manager", market_id: "m1" },
          error: null,
        });
      if (t === "leads")
        return chain({
          data: {
            id: "lead-1",
            market_id: "m1",
            assigned_to: null,
            status: "assigned",
          },
          error: null,
        });
      return chain({ data: null, error: null });
    });

    const res = await PATCH(
      req("PATCH", "/api/leads/lead-1", { random_field: "Y" }),
      params
    );
    expect(res.status).toBe(400);
  });

  test("200 and writes history on valid edit", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });

    let leadsChain: ReturnType<typeof chain>;
    let historyChain: ReturnType<typeof chain>;

    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({
          data: { role: "market_manager", market_id: "m1" },
          error: null,
        });
      if (t === "leads") {
        leadsChain = chain({
          data: {
            id: "lead-1",
            market_id: "m1",
            assigned_to: null,
            status: "assigned",
          },
          error: null,
        });
        // update returns chain
        leadsChain.update = vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        });
        return leadsChain;
      }
      if (t === "lead_history") {
        historyChain = chain({ data: null, error: null });
        return historyChain;
      }
      return chain({ data: null, error: null });
    });

    const res = await PATCH(
      req("PATCH", "/api/leads/lead-1", { customer_name: "Updated" }),
      params
    );
    expect(res.status).toBe(200);
    expect(historyChain!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        lead_id: "lead-1",
        status_from: "assigned",
        status_to: "assigned",
      })
    );
  });
});

describe("DELETE /api/leads/[id]", () => {
  test("403 for agents", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) =>
      t === "users"
        ? chain({ data: { role: "agent", market_id: "m1" }, error: null })
        : chain({ data: null, error: null })
    );

    const res = await DELETE(req("DELETE", "/api/leads/lead-1"), params);
    expect(res.status).toBe(403);
  });

  test("409 when already terminal", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({
          data: { role: "market_manager", market_id: "m1" },
          error: null,
        });
      if (t === "leads")
        return chain({
          data: { market_id: "m1", status: "archived" },
          error: null,
        });
      return chain({ data: null, error: null });
    });

    const res = await DELETE(req("DELETE", "/api/leads/lead-1"), params);
    expect(res.status).toBe(409);
  });

  test("200 via transition RPC on valid archive", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mgr" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users")
        return chain({
          data: { role: "market_manager", market_id: "m1" },
          error: null,
        });
      if (t === "leads")
        return chain({
          data: { market_id: "m1", status: "attempt_1" },
          error: null,
        });
      return chain({ data: null, error: null });
    });
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        status: "archived",
        updated_at: "2026-04-18T00:00:00Z",
        history_id: "h-arc",
      },
      error: null,
    });

    const res = await DELETE(req("DELETE", "/api/leads/lead-1"), params);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith(
      "transition_lead_status",
      expect.objectContaining({
        p_lead_id: "lead-1",
        p_new_status: "archived",
      })
    );
  });
});
