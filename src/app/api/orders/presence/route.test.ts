import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockGetActor = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...a: unknown[]) => mockFrom(...a),
    rpc: (...a: unknown[]) => mockRpc(...a),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { GET } from "./route";
import { NextResponse } from "next/server";

function chain(rows: unknown[]) {
  const c: Record<string, unknown> = { rows };
  c.select = vi.fn(() => c);
  c.gt = vi.fn().mockResolvedValue({ data: rows, error: null });
  return c;
}

const req = () => new Request("http://x/api/orders/presence") as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockImplementation(() => chain([]));
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/orders/presence", () => {
  test("serves a market_manager", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "m-1", role: "market_manager", market_id: "m" } });
    expect((await GET(req())).status).toBe(200);
  });

  // An agent must be able to see that a manager is standing on THEIR order.
  // RLS already scopes what comes back (own rows + rows on orders assigned to
  // them), so a role gate here only breaks the agent half of the feature.
  test("serves an agent too — RLS does the scoping, not a role gate", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a-1", role: "agent", market_id: "m" } });
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("list_order_presence");
  });

  test("still refuses a warehouse_agent, who has no business here", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "w-1", role: "warehouse_agent", market_id: "m" } });
    expect((await GET(req())).status).toBe(403);
  });

  test("refuses an unauthenticated caller", async () => {
    mockGetActor.mockResolvedValue({
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET(req())).status).toBe(401);
  });

  test("returns server_now for clock-skew correction", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a-1", role: "agent", market_id: "m" } });
    const body = await (await GET(req())).json();
    expect(typeof body.server_now).toBe("string");
  });
});

describe("GET /api/orders/presence — identity", () => {
  test("embeds the holder's name and photo so the client needs no directory", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "m-1", role: "market_manager", market_id: "m" } });
    mockRpc.mockResolvedValue({
      data: [{
        order_id: "o-1", user_id: "u-9", role: "market_manager", mode: "viewing",
        opened_at: "t", expires_at: "t2",
        full_name: "Imen", avatar_url: "https://x/i.jpg",
      }],
      error: null,
    });

    const body = await (await GET(req())).json();

    // /api/agents is role='agent' only, so a manager's head icon could never be
    // named from it — and an unnamed head renders as the dashed "unassigned +".
    expect(body.data[0].full_name).toBe("Imen");
    expect(body.data[0].avatar_url).toBe("https://x/i.jpg");
    // Via the SECURITY DEFINER reader: `users` RLS blocks an agent from
    // reading a manager's row, so a plain embedded join yields NULL.
    expect(mockRpc).toHaveBeenCalledWith("list_order_presence");
  });

  test("survives a row whose user join came back empty", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "m-1", role: "market_manager", market_id: "m" } });
    mockRpc.mockResolvedValue({
      data: [{ order_id: "o-1", user_id: "u-9", role: "agent", mode: "viewing", opened_at: "t", expires_at: "t2", full_name: null, avatar_url: null }],
      error: null,
    });
    const body = await (await GET(req())).json();
    expect(body.data[0].full_name).toBeNull();
  });
});
