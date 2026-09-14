import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockIn = vi.fn();
const mockOrdersIn = vi.fn();
// The route reads two tables by id; each gets its own result.
const mockFrom = vi.fn((table: string) => ({
  select: () => ({ in: (...a: unknown[]) => (table === "orders" ? mockOrdersIn(...a) : mockIn(...a)) }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...(args as [string])),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { DEFAULT_LIMIT, MAX_LIMIT } from "@/lib/delivery/worklist";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const AGENT_B = "6e5367ef-f04d-412b-886d-f8b9dae6b148";
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/delivery/worklist${q}`));
const as = (id: string, role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: [], error: null });
  mockIn.mockResolvedValue({ data: [], error: null });
  mockOrdersIn.mockResolvedValue({ data: [], error: null });
});

describe("GET /api/delivery/worklist", () => {
  test("warehouse agents and investors are refused", async () => {
    as("w", "warehouse_agent", LY);
    expect((await GET(req())).status).toBe(403);
    as("i", "investor", null);
    expect((await GET(req())).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("an agent always gets their own list in their own market, whatever the query says", async () => {
    as("a1", "agent", LY);
    await GET(req(`?agent_id=${AGENT_B}&market_id=${TN}`));
    expect(mockRpc).toHaveBeenCalledWith("get_delivery_worklist", expect.objectContaining({ p_market_id: LY, p_agent_id: "a1" }));
  });

  test("a market manager is pinned to their market and may narrow to one agent", async () => {
    as("m", "market_manager", LY);
    await GET(req(`?market_id=${TN}`));
    expect(mockRpc).toHaveBeenLastCalledWith("get_delivery_worklist", expect.objectContaining({ p_market_id: LY, p_agent_id: null }));
    await GET(req(`?agent_id=${AGENT_B}`));
    expect(mockRpc).toHaveBeenLastCalledWith("get_delivery_worklist", expect.objectContaining({ p_market_id: LY, p_agent_id: AGENT_B }));
  });

  test("a malformed agent id is a 400, not a SQL error", async () => {
    as("m", "market_manager", LY);
    expect((await GET(req("?agent_id=nope"))).status).toBe(400);
  });

  test("super admin must name a valid market", async () => {
    as("s", "super_admin", null);
    expect((await GET(req())).status).toBe(400);
    await GET(req(`?market_id=${TN}`));
    expect(mockRpc).toHaveBeenCalledWith("get_delivery_worklist", expect.objectContaining({ p_market_id: TN, p_agent_id: null }));
  });

  test("rows come back with their items attached", async () => {
    as("a1", "agent", LY);
    mockRpc.mockResolvedValue({
      data: [
        { order_id: "o1", bucket: "act_now", reason_codes: ["proactive"] },
        { order_id: "o2", bucket: "done", reason_codes: null },
      ],
      error: null,
    });
    mockIn.mockResolvedValue({
      data: [
        // PostGREST embeds the product as an object; the generated types say array. Both must work.
        { order_id: "o1", product_name: "Sérum", variant_label: null, quantity: 2, product: { image_url: "https://cdn/serum.jpg" } },
        { order_id: "o1", product_name: "Crème", variant_label: "50ml", quantity: 1, product: [{ image_url: null }] },
      ],
      error: null,
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockFrom).toHaveBeenCalledWith("order_items");
    expect(body.rows[0].items).toEqual([
      { product_name: "Sérum", variant_label: null, quantity: 2, image_url: "https://cdn/serum.jpg" },
      { product_name: "Crème", variant_label: "50ml", quantity: 1, image_url: null },
    ]);
    expect(body.rows[1].items).toEqual([]);
    expect(body.rows[1].reason_codes).toEqual([]);
    expect(typeof body.generated_at).toBe("string");
  });

  // Only ~10 of 206 live Libyan parcels have order_items rows; the rest predate
  // that table and carry their product on the order itself, which is what the
  // agent queue reads. Without this fallback every one of them shows no picture.
  test("an order with no items falls back to the product on the order itself", async () => {
    as("a1", "agent", LY);
    mockRpc.mockResolvedValue({
      data: [{ order_id: "o1", bucket: "act_now", reason_codes: [] }, { order_id: "o2", bucket: "act_now", reason_codes: [] }],
      error: null,
    });
    mockIn.mockResolvedValue({ data: [], error: null });
    mockOrdersIn.mockResolvedValue({
      data: [
        { id: "o1", product_name: "دمية", variant_label: "كبير", quantity: 2, product: { image_url: "https://cdn/doll.jpg" } },
        { id: "o2", product_name: null, variant_label: null, quantity: 1, product: null },
      ],
      error: null,
    });
    const body = await (await GET(req())).json();
    expect(mockFrom).toHaveBeenCalledWith("orders");
    expect(body.rows[0].items).toEqual([
      { product_name: "دمية", variant_label: "كبير", quantity: 2, image_url: "https://cdn/doll.jpg" },
    ]);
    // Nothing to show is still nothing: no empty placeholder item.
    expect(body.rows[1].items).toEqual([]);
  });

  test("order_items win when they exist: the fallback does not double up", async () => {
    as("a1", "agent", LY);
    mockRpc.mockResolvedValue({ data: [{ order_id: "o1", bucket: "act_now", reason_codes: [] }], error: null });
    mockIn.mockResolvedValue({
      data: [{ order_id: "o1", product_name: "Sérum", variant_label: null, quantity: 1, product: { image_url: "https://cdn/s.jpg" } }],
      error: null,
    });
    mockOrdersIn.mockResolvedValue({
      data: [{ id: "o1", product_name: "Ancien", variant_label: null, quantity: 9, product: { image_url: "https://cdn/old.jpg" } }],
      error: null,
    });
    const body = await (await GET(req())).json();
    expect(body.rows[0].items).toEqual([
      { product_name: "Sérum", variant_label: null, quantity: 1, image_url: "https://cdn/s.jpg" },
    ]);
  });

  test("an RPC failure is a 500 without leaking the SQL message", async () => {
    as("a1", "agent", LY);
    mockRpc.mockResolvedValue({ data: null, error: { message: "relation x does not exist" } });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("relation");
  });

  // ── Paging and the done tab ───────────────────────────────────────────────
  // 89 of the 210 live Libyan parcels are `done` — closed in the last 24 h and
  // needing nothing. They are a tab the agent opens, not part of the first
  // paint, so the default request leaves them in the database.

  test("by default the list skips terminal parcels", async () => {
    as("a1", "agent", LY);
    await GET(req());
    expect(mockRpc).toHaveBeenCalledWith("get_delivery_worklist",
      expect.objectContaining({ p_include_done: false }));
  });

  test("include_done=1 asks for them, for the done tab", async () => {
    as("a1", "agent", LY);
    await GET(req("?include_done=1"));
    expect(mockRpc).toHaveBeenCalledWith("get_delivery_worklist",
      expect.objectContaining({ p_include_done: true }));
  });

  test("limit and offset are passed through, and clamped to something sane", async () => {
    as("m", "market_manager", LY);
    await GET(req("?limit=50&offset=100"));
    expect(mockRpc).toHaveBeenLastCalledWith("get_delivery_worklist",
      expect.objectContaining({ p_limit: 50, p_offset: 100 }));

    // A caller asking for everything must not be able to ask for more than the
    // page can draw, nor for a negative offset.
    await GET(req("?limit=99999&offset=-5"));
    expect(mockRpc).toHaveBeenLastCalledWith("get_delivery_worklist",
      expect.objectContaining({ p_limit: MAX_LIMIT, p_offset: 0 }));

    // Garbage is ignored rather than forwarded as NaN.
    await GET(req("?limit=abc&offset=xyz"));
    expect(mockRpc).toHaveBeenLastCalledWith("get_delivery_worklist",
      expect.objectContaining({ p_limit: DEFAULT_LIMIT, p_offset: 0 }));
  });

  test("the response reports the full total so the page knows what it did not get", async () => {
    as("a1", "agent", LY);
    mockRpc.mockResolvedValue({
      data: [{ order_id: "o1", bucket: "act_now", reason_codes: [], total_count: 207 }],
      error: null,
    });
    const body = await (await GET(req("?limit=1"))).json();
    expect(body.total).toBe(207);
    expect(body.rows[0].total_count).toBeUndefined();
  });

  test("an empty page reports a zero total rather than undefined", async () => {
    as("a1", "agent", LY);
    mockRpc.mockResolvedValue({ data: [], error: null });
    const body = await (await GET(req())).json();
    expect(body.total).toBe(0);
    expect(body.rows).toEqual([]);
  });
});
