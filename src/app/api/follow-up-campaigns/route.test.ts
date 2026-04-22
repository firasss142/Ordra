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

import { GET, POST } from "./route";
import { NextRequest } from "next/server";

function req(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  const init: Record<string, unknown> = {
    method,
    headers: {
      "content-type": "application/json",
      ...headers,
    },
  };
  if (body) init.body = JSON.stringify(body);
  return new NextRequest(new URL(url, "http://localhost:3000"), init as never);
}

function managerHeaders(marketId = "mkt-tn") {
  return {
    "x-oms-role": "market_manager",
    "x-oms-actor-id": "mgr-1",
    "x-oms-market-id": marketId,
  };
}

function queryChain(resolveWith: { data: unknown; error: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  const methods = ["select", "eq", "gte", "lte", "in", "order", "range", "insert", "limit", "maybeSingle"];
  methods.forEach((m) => {
    chain[m] = vi.fn().mockReturnValue(chain);
  });
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  chain.range = vi.fn().mockResolvedValue({
    data: resolveWith.data,
    error: resolveWith.error,
    count: resolveWith.count ?? null,
  });
  chain.select = vi.fn().mockReturnValue({
    ...chain,
    // When used with head:true for count-only queries
    eq: vi.fn().mockReturnValue({
      ...chain,
      order: vi.fn().mockResolvedValue({ data: resolveWith.data, error: resolveWith.error, count: resolveWith.count }),
    }),
  });
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/follow-up-campaigns", () => {
  test("returns 401 without auth headers", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req("GET", "/api/follow-up-campaigns"));
    expect(res.status).toBe(401);
  });

  test("agent gets campaigns scoped to own market", async () => {
    const campaigns = [
      { id: "c1", market_id: "mkt-tn", name: "April callbacks", filter_json: {}, created_at: "2026-04-21T10:00:00Z" },
    ];
    const eqFn = vi.fn();
    mockFrom.mockImplementation(() => {
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => void) => resolve({ data: campaigns, error: null }),
        catch: vi.fn(),
      };
      chain.select = vi.fn().mockReturnValue(chain);
      eqFn.mockReturnValue(chain);
      chain.eq = eqFn;
      chain.order = vi.fn().mockReturnValue(chain);
      return chain;
    });

    const res = await GET(
      req("GET", "/api/follow-up-campaigns", undefined, {
        "x-oms-role": "agent",
        "x-oms-actor-id": "agent-1",
        "x-oms-market-id": "mkt-tn",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("April callbacks");
    expect(eqFn).toHaveBeenCalledWith("market_id", "mkt-tn");
  });

  test("manager gets campaigns for own market", async () => {
    const campaigns = [
      { id: "c1", market_id: "mkt-tn", name: "April callbacks", filter_json: {}, created_at: "2026-04-21T10:00:00Z" },
    ];
    mockFrom.mockImplementation(() => {
      // The chain must be thenable (awaitable) so the final await query resolves
      const chain: Record<string, unknown> = {
        then: (resolve: (v: unknown) => void) => resolve({ data: campaigns, error: null }),
        catch: vi.fn(),
      };
      chain.select = vi.fn().mockReturnValue(chain);
      chain.eq = vi.fn().mockReturnValue(chain);
      chain.order = vi.fn().mockReturnValue(chain);
      return chain;
    });

    const res = await GET(req("GET", "/api/follow-up-campaigns?market_id=mkt-tn", undefined, managerHeaders()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].name).toBe("April callbacks");
  });
});

describe("POST /api/follow-up-campaigns", () => {
  test("returns 401 without auth", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(req("POST", "/api/follow-up-campaigns", { name: "test", filter_json: {} }));
    expect(res.status).toBe(401);
  });

  test("agent cannot create a campaign", async () => {
    const res = await POST(
      req(
        "POST",
        "/api/follow-up-campaigns",
        { name: "test", filter_json: {} },
        { "x-oms-role": "agent", "x-oms-actor-id": "a1", "x-oms-market-id": "mkt-tn" }
      )
    );
    expect(res.status).toBe(403);
  });

  test("missing name returns 400", async () => {
    const res = await POST(
      req("POST", "/api/follow-up-campaigns", { filter_json: {} }, managerHeaders())
    );
    expect(res.status).toBe(400);
  });

  test("creates campaign + calls bulk RPC, returns counts", async () => {
    const newCampaign = { id: "camp-1", market_id: "mkt-tn", name: "April callbacks" };
    let insertChain: Record<string, unknown>;

    mockFrom.mockImplementation(() => {
      insertChain = {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: newCampaign, error: null }),
          }),
        }),
      };
      return insertChain;
    });

    mockRpc.mockResolvedValue({
      data: { campaign_id: "camp-1", created_count: 5, skipped_count: 2 },
      error: null,
    });

    const res = await POST(
      req(
        "POST",
        "/api/follow-up-campaigns",
        { name: "April callbacks", filter_json: { statuses: ["delivered"], date_from: "2026-04-07" } },
        managerHeaders()
      )
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.campaign_id).toBe("camp-1");
    expect(body.data.created_count).toBe(5);
    expect(body.data.skipped_count).toBe(2);

    expect(mockRpc).toHaveBeenCalledWith("bulk_create_campaign_follow_ups", expect.objectContaining({
      p_campaign_id: "camp-1",
    }));
  });

  test("duplicate name returns 409", async () => {
    mockFrom.mockImplementation(() => ({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: "23505", message: "duplicate key" },
          }),
        }),
      }),
    }));

    const res = await POST(
      req(
        "POST",
        "/api/follow-up-campaigns",
        { name: "April callbacks", filter_json: {} },
        managerHeaders()
      )
    );
    expect(res.status).toBe(409);
  });
});
