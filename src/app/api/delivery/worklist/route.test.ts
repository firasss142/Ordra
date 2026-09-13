import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
const mockIn = vi.fn();
const mockFrom = vi.fn(() => ({ select: () => ({ in: (...a: unknown[]) => mockIn(...a) }) }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (...args: unknown[]) => mockFrom(...(args as [])),
  }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
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
    expect(mockRpc).toHaveBeenCalledWith("get_delivery_worklist", { p_market_id: LY, p_agent_id: "a1" });
  });

  test("a market manager is pinned to their market and may narrow to one agent", async () => {
    as("m", "market_manager", LY);
    await GET(req(`?market_id=${TN}`));
    expect(mockRpc).toHaveBeenLastCalledWith("get_delivery_worklist", { p_market_id: LY, p_agent_id: null });
    await GET(req(`?agent_id=${AGENT_B}`));
    expect(mockRpc).toHaveBeenLastCalledWith("get_delivery_worklist", { p_market_id: LY, p_agent_id: AGENT_B });
  });

  test("a malformed agent id is a 400, not a SQL error", async () => {
    as("m", "market_manager", LY);
    expect((await GET(req("?agent_id=nope"))).status).toBe(400);
  });

  test("super admin must name a valid market", async () => {
    as("s", "super_admin", null);
    expect((await GET(req())).status).toBe(400);
    await GET(req(`?market_id=${TN}`));
    expect(mockRpc).toHaveBeenCalledWith("get_delivery_worklist", { p_market_id: TN, p_agent_id: null });
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
        { order_id: "o1", product_name: "Sérum", variant_label: null, quantity: 2 },
        { order_id: "o1", product_name: "Crème", variant_label: "50ml", quantity: 1 },
      ],
      error: null,
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(mockFrom).toHaveBeenCalledWith("order_items");
    expect(body.rows[0].items).toEqual([
      { product_name: "Sérum", variant_label: null, quantity: 2 },
      { product_name: "Crème", variant_label: "50ml", quantity: 1 },
    ]);
    expect(body.rows[1].items).toEqual([]);
    expect(body.rows[1].reason_codes).toEqual([]);
    expect(typeof body.generated_at).toBe("string");
  });

  test("an RPC failure is a 500 without leaking the SQL message", async () => {
    as("a1", "agent", LY);
    mockRpc.mockResolvedValue({ data: null, error: { message: "relation x does not exist" } });
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("relation");
  });
});
