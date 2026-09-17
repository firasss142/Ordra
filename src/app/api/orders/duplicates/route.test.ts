import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockRpc = vi.fn();
const mockGetWindow = vi.fn();
const mockGetAutoselect = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...a: unknown[]) => mockRpc(...a) }),
  createAdminClient: vi.fn().mockReturnValue({}),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));

vi.mock("@/lib/duplicate-orders/window", async () => {
  const actual = await vi.importActual<typeof import("@/lib/duplicate-orders/window")>(
    "@/lib/duplicate-orders/window",
  );
  return {
    ...actual,
    getDuplicateWindowHours: (...a: unknown[]) => mockGetWindow(...a),
    getAutoselectWindowHours: (...a: unknown[]) => mockGetAutoselect(...a),
  };
});

import { GET } from "./route";
import { NextRequest } from "next/server";

const MANAGER = { id: "mgr-1", role: "market_manager", market_id: "m-1" };
const AGENT = { id: "agent-1", role: "agent", market_id: "m-1" };

function req(url = "http://localhost:3000/api/orders/duplicates?market_id=m-1") {
  return new NextRequest(new URL(url));
}

function memberRow(o: Record<string, unknown> = {}) {
  return {
    id: "o-1",
    external_id: "EXT-1",
    status: "pending",
    created_at: "2026-09-17T10:00:00Z",
    product_id: "p-1",
    product_name: "Widget",
    product_image_url: null,
    quantity: 1,
    unit_price: 100,
    total_price: 129,
    customer_name: "Ahmed",
    customer_address: "12 Rue X",
    customer_city: "Tripoli",
    already_shipped: false,
    is_anchor: false,
    deletable: true,
    ...o,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: MANAGER });
  mockGetWindow.mockResolvedValue(24);
  mockGetAutoselect.mockResolvedValue(1);
  mockRpc.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/orders/duplicates", () => {
  test("returns 401 when unauthenticated", async () => {
    mockGetActor.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    });
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("returns 400 when market_id is missing", async () => {
    const res = await GET(req("http://localhost:3000/api/orders/duplicates"));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("refuses a market_manager asking for another market", async () => {
    const res = await GET(req("http://localhost:3000/api/orders/duplicates?market_id=other"));
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("lets a super_admin read any market", async () => {
    mockGetActor.mockResolvedValue({
      actor: { id: "a", role: "super_admin", market_id: null },
    });
    const res = await GET(req("http://localhost:3000/api/orders/duplicates?market_id=anything"));
    expect(res.status).toBe(200);
  });

  test("passes the market's configured window to the RPC", async () => {
    mockGetWindow.mockResolvedValue(48);
    await GET(req());
    expect(mockRpc).toHaveBeenCalledWith(
      "get_duplicate_groups",
      expect.objectContaining({ p_market_id: "m-1", p_window_hours: 48 }),
    );
  });

  test("shapes rows into groups with confidence and derived flags", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          group_key: "921|p-1",
          member_count: 2,
          members: [
            memberRow({ id: "new", created_at: "2026-09-17T10:20:00Z", is_anchor: true }),
            memberRow({ id: "old", created_at: "2026-09-17T10:00:00Z" }),
          ],
        },
      ],
      error: null,
    });
    const res = await GET(req());
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.groups).toHaveLength(1);
    const g = json.data.groups[0];
    expect(g.key).toBe("921|p-1");
    expect(g.confidence).toBe("high");
    expect(g.address_matches).toBe(true);
    expect(g.span_minutes).toBe(20);
  });

  test("marks a group review when a member is already shipped", async () => {
    mockRpc.mockResolvedValue({
      data: [
        {
          group_key: "g",
          member_count: 2,
          members: [
            memberRow({ id: "new", created_at: "2026-09-17T10:10:00Z", is_anchor: true }),
            memberRow({
              id: "shipped",
              created_at: "2026-09-17T10:00:00Z",
              already_shipped: true,
              status: "delivered",
              deletable: false,
            }),
          ],
        },
      ],
      error: null,
    });
    const json = await (await GET(req())).json();
    expect(json.data.groups[0].confidence).toBe("review");
  });

  test("returns 500 when the RPC errors rather than an empty list", async () => {
    // An empty list and a failed query look identical to the user otherwise,
    // and "no duplicates" is exactly the wrong thing to show on a failure.
    mockRpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET(req());
    expect(res.status).toBe(500);
  });

  test("allows an agent to read (the screen is read-only for them)", async () => {
    mockGetActor.mockResolvedValue({ actor: AGENT });
    const res = await GET(req());
    expect(res.status).toBe(200);
  });
});
