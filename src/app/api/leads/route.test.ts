import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

function req(method: string, url: string, body?: unknown) {
  const init: Record<string, unknown> = { method };
  if (body) init.body = JSON.stringify(body);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new NextRequest(new URL(url, "http://localhost:3000"), init as any);
}

function queryChain(resolveWith: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockReturnValue(chain);
  chain.lte = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.range = vi.fn().mockResolvedValue({
    data: resolveWith.data,
    error: resolveWith.error,
    count: resolveWith.count,
  });
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/leads", () => {
  test("returns 401 without auth", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req("GET", "/api/leads"));
    expect(res.status).toBe(401);
  });

  test("agent sees only own assigned leads", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });

    let leadChain: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({
          data: { role: "agent", market_id: "mkt-tn" },
          error: null,
        });
      }
      if (table === "leads") {
        leadChain = queryChain({ data: [], error: null, count: 0 });
        return leadChain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await GET(req("GET", "/api/leads"));
    expect(res.status).toBe(200);
    // assigned_to = agent-1 filter must be applied
    expect(leadChain!.eq).toHaveBeenCalledWith("assigned_to", "agent-1");
  });

  test("super_admin can request any market_id", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "sa-1" } },
      error: null,
    });

    let leadChain: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({
          data: { role: "super_admin", market_id: null },
          error: null,
        });
      }
      if (table === "leads") {
        leadChain = queryChain({ data: [], error: null, count: 0 });
        return leadChain;
      }
      return queryChain({ data: null, error: null });
    });

    await GET(req("GET", "/api/leads?market_id=mkt-ly"));
    expect(leadChain!.eq).toHaveBeenCalledWith("market_id", "mkt-ly");
  });
});

describe("POST /api/leads", () => {
  test("returns 400 when required fields missing", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "mgr-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({
          data: { role: "market_manager", market_id: "mkt-tn" },
          error: null,
        });
      }
      return queryChain({ data: null, error: null });
    });

    const res = await POST(
      req("POST", "/api/leads", { customer_name: "Test" })
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 on invalid source", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "mgr-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({
          data: { role: "market_manager", market_id: "mkt-tn" },
          error: null,
        });
      }
      return queryChain({ data: null, error: null });
    });

    const res = await POST(
      req("POST", "/api/leads", {
        customer_name: "T",
        customer_phone: "+216111",
        source: "pigeon",
      })
    );
    expect(res.status).toBe(400);
  });

  test("agent self-assigns on create (status=assigned, assigned_to=self)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "agent-1" } },
      error: null,
    });

    const insertedLead = {
      id: "lead-new",
      status: "assigned",
      assigned_to: "agent-1",
      created_at: "2026-04-18T00:00:00Z",
    };

    let leadsChain: ReturnType<typeof queryChain>;
    let historyChain: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({
          data: { role: "agent", market_id: "mkt-tn" },
          error: null,
        });
      }
      if (table === "leads") {
        leadsChain = queryChain({ data: insertedLead, error: null });
        return leadsChain;
      }
      if (table === "lead_history") {
        historyChain = queryChain({ data: null, error: null });
        return historyChain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await POST(
      req("POST", "/api/leads", {
        customer_name: "Caller",
        customer_phone: "+216111",
        source: "manual_call",
      })
    );

    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.status).toBe("assigned");
    expect(json.data.assigned_to).toBe("agent-1");
    expect(leadsChain!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "assigned",
        assigned_to: "agent-1",
        market_id: "mkt-tn",
        source: "manual_call",
      })
    );
    expect(historyChain!.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status_from: null,
        status_to: "assigned",
        actor_type: "agent",
      })
    );
  });

  test("manager-created lead stays unassigned (status=new)", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "mgr-1" } },
      error: null,
    });

    let leadsChain: ReturnType<typeof queryChain>;
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({
          data: { role: "market_manager", market_id: "mkt-tn" },
          error: null,
        });
      }
      if (table === "leads") {
        leadsChain = queryChain({
          data: {
            id: "lead-new",
            status: "new",
            assigned_to: null,
            created_at: "2026-04-18T00:00:00Z",
          },
          error: null,
        });
        return leadsChain;
      }
      return queryChain({ data: null, error: null });
    });

    const res = await POST(
      req("POST", "/api/leads", {
        customer_name: "Caller",
        customer_phone: "+216111",
        source: "facebook_comment",
      })
    );

    expect(res.status).toBe(201);
    expect(leadsChain!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ status: "new", assigned_to: null })
    );
  });

  test("manager cannot override market_id to another market", async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: "mgr-1" } },
      error: null,
    });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return queryChain({
          data: { role: "market_manager", market_id: "mkt-tn" },
          error: null,
        });
      }
      if (table === "leads") {
        return queryChain({
          data: {
            id: "x",
            status: "new",
            assigned_to: null,
            created_at: "x",
          },
          error: null,
        });
      }
      return queryChain({ data: null, error: null });
    });

    // Body sends market_id=mkt-ly but manager is in mkt-tn → must ignore and use own
    const res = await POST(
      req("POST", "/api/leads", {
        customer_name: "C",
        customer_phone: "+216111",
        source: "manual_call",
        market_id: "mkt-ly",
      })
    );

    expect(res.status).toBe(201);
  });
});
