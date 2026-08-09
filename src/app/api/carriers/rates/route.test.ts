import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();
const mockRecommend = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
  createAdminClient: vi.fn().mockReturnValue({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

vi.mock("@/lib/carriers/recommend-carrier-for-order", () => ({
  recommendCarrierForOrder: (...args: unknown[]) => mockRecommend(...args),
}));

import { GET } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const TRIPOLI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
const BENGHAZI = "43077d36-3d61-40d6-ae35-59ed15cec8f7";

function req(url: string) {
  return new NextRequest(new URL(url, "http://localhost:3000"), { method: "GET" });
}

function orderChain(order: Record<string, unknown> | null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({
    data: order,
    error: order ? null : { message: "not found" },
  });
  return c;
}

function destChain(dest: Record<string, unknown> | null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn().mockResolvedValue({ data: dest, error: null });
  return c;
}

const LY_ORDER = {
  id: "order-1",
  market_id: "m-1",
  assigned_to: "agent-1",
  customer_city: "بنغازي",
  darb_destination_id: null,
};

const RANKED = [
  {
    carrierId: BENGHAZI,
    carrierName: "Darb Assabil — Benghazi",
    quotedFee: 10,
    quoteUsable: true,
    trueCostPerDelivered: 10.73,
    effectiveCost: 10,
    isCheapest: true,
  },
  {
    carrierId: TRIPOLI,
    carrierName: "Darb Assabil - Tripoli",
    quotedFee: 30,
    quoteUsable: true,
    trueCostPerDelivered: 11.65,
    effectiveCost: 30,
    isCheapest: false,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
  setTestActor({ role: "market_manager", market_id: "m-1" });
  mockFrom.mockReturnValue(orderChain(LY_ORDER));
  mockAdminFrom.mockReturnValue(destChain(null));
  mockRecommend.mockResolvedValue({
    carrier_id: BENGHAZI,
    reason: "quote",
    ranked: RANKED,
  });
});

describe("GET /api/carriers/rates", () => {
  test("400 without order_id", async () => {
    expect((await GET(req("/api/carriers/rates"))).status).toBe(400);
  });

  test("404 for an unknown order", async () => {
    mockFrom.mockReturnValue(orderChain(null));
    expect((await GET(req("/api/carriers/rates?order_id=nope"))).status).toBe(404);
  });

  test("403 for an order in another market", async () => {
    setTestActor({ role: "market_manager", market_id: "m-2" });
    expect((await GET(req("/api/carriers/rates?order_id=order-1"))).status).toBe(403);
  });

  // Mirrors GET /api/orders/[id] — an agent must not read another agent's order.
  test("404 when an agent asks about an order assigned to someone else", async () => {
    setTestActor({ id: "agent-2", role: "agent", market_id: "m-1" });
    expect((await GET(req("/api/carriers/rates?order_id=order-1"))).status).toBe(404);
  });

  test("an agent can read their own assigned order", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-1" });
    expect((await GET(req("/api/carriers/rates?order_id=order-1"))).status).toBe(200);
  });

  test("returns one entry per carrier with the cheapest flagged", async () => {
    const res = await GET(req("/api/carriers/rates?order_id=order-1"));
    const body = await res.json();
    expect(body.data.recommended_carrier_id).toBe(BENGHAZI);
    expect(body.data.reason).toBe("quote");
    expect(body.data.rates).toHaveLength(2);
    expect(body.data.rates[0]).toMatchObject({
      carrier_id: BENGHAZI,
      quoted_fee: 10,
      is_cheapest: true,
    });
  });

  // Missing is not zero — the badge must be able to render nothing.
  test("returns quoted_fee null, not 0, when there is no rate", async () => {
    mockRecommend.mockResolvedValue({
      carrier_id: TRIPOLI,
      reason: "true_cost",
      ranked: [{ ...RANKED[0], quotedFee: null, quoteUsable: false, effectiveCost: 10.73 }],
    });
    const body = await (await GET(req("/api/carriers/rates?order_id=order-1"))).json();
    expect(body.data.rates[0].quoted_fee).toBeNull();
  });

  test("resolves the destination from the persisted darb_destination_id when set", async () => {
    mockFrom.mockReturnValue(orderChain({ ...LY_ORDER, darb_destination_id: 42 }));
    mockAdminFrom.mockReturnValue(destChain({ city: "درنة", area: "مرتوبة" }));
    await GET(req("/api/carriers/rates?order_id=order-1"));
    expect(mockRecommend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ city: "درنة", area: "مرتوبة" }),
    );
  });

  test("falls back to resolving the stored city string", async () => {
    await GET(req("/api/carriers/rates?order_id=order-1"));
    expect(mockRecommend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ city: "بنغازي" }),
    );
  });

  test("returns an empty payload for a market with no recommendation", async () => {
    mockRecommend.mockResolvedValue({ carrier_id: null, reason: "none", ranked: [] });
    const body = await (await GET(req("/api/carriers/rates?order_id=order-1"))).json();
    expect(body.data).toMatchObject({ recommended_carrier_id: null, reason: "none", rates: [] });
  });
});
