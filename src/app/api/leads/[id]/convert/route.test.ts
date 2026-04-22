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
    new URL("/api/leads/lead-1/convert", "http://localhost:3000"),
    { method: "POST", body: JSON.stringify(body) } as any
  );
}

function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  return c;
}

const params = { params: Promise.resolve({ id: "lead-1" }) };

const goodOrder = {
  product_id: "prod-1",
  product_name: "Widget",
  quantity: 1,
  unit_price: 50,
  total_price: 50,
  customer_name: "C",
  customer_phone: "+216111",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/leads/[id]/convert", () => {
  test("404 for agent when lead assigned elsewhere", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "qualified",
          assigned_to: "agent-2",
          market_id: "m1",
        });
      return chain(null);
    });

    const res = await POST(req(goodOrder), params);
    expect(res.status).toBe(404);
  });

  test("409 when lead not qualified", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "attempt_1",
          assigned_to: "agent-1",
          market_id: "m1",
        });
      return chain(null);
    });

    const res = await POST(req(goodOrder), params);
    expect(res.status).toBe(409);
  });

  test("400 on missing required fields", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "qualified",
          assigned_to: "agent-1",
          market_id: "m1",
        });
      return chain(null);
    });

    const res = await POST(req({ product_name: "X" }), params);
    expect(res.status).toBe(400);
  });

  test("201 on success — calls convert_lead_to_order", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "agent-1" } }, error: null });
    mockFrom.mockImplementation((t: string) => {
      if (t === "users") return chain({ role: "agent", market_id: "m1" });
      if (t === "leads")
        return chain({
          id: "lead-1",
          status: "qualified",
          assigned_to: "agent-1",
          market_id: "m1",
        });
      return chain(null);
    });
    mockRpc.mockResolvedValue({
      data: {
        lead_id: "lead-1",
        order_id: "order-new",
        lead_status: "won",
        order_status: "confirmed",
        lead_history_id: "lh",
        order_history_id: "oh",
      },
      error: null,
    });

    const res = await POST(req(goodOrder), params);
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith(
      "convert_lead_to_order",
      expect.objectContaining({
        p_lead_id: "lead-1",
        p_actor_id: "agent-1",
        p_product_name: "Widget",
        p_quantity: 1,
        p_total_price: 50,
      })
    );
  });
});
