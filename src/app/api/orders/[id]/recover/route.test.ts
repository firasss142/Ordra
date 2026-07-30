import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
}));

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { POST } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";
import type { Role } from "@/types";

const ORDER_ID = "11111111-1111-1111-1111-111111111111";

function createRequest(
  body: unknown = {},
  actor: { role: Role; id?: string; marketId?: string } = {
    role: "market_manager",
    id: "mgr-1",
    marketId: "m-1",
  },
) {
  setTestActor({
    role: actor.role,
    id: actor.id ?? "actor-1",
    market_id: actor.marketId ?? null,
  });
  return new NextRequest(
    new URL(`http://localhost:3000/api/orders/${ORDER_ID}/recover`),
    {
      method: "POST",
      body: JSON.stringify(body),
    },
  );
}

const params = Promise.resolve({ id: ORDER_ID });

function orderChain(resolveWith: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.single = vi.fn().mockResolvedValue(resolveWith);
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTestActor();
});

describe("POST /api/orders/[id]/recover", () => {
  test("forbids agents", async () => {
    mockFrom.mockReturnValue(
      orderChain({ data: { id: ORDER_ID, status: "deleted", market_id: "m-1" }, error: null }),
    );
    const res = await POST(
      createRequest({}, { role: "agent", id: "a-1", marketId: "m-1" }),
      { params },
    );
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("manager cannot recover another market's order", async () => {
    mockFrom.mockReturnValue(
      orderChain({ data: { id: ORDER_ID, status: "deleted", market_id: "m-2" }, error: null }),
    );
    const res = await POST(createRequest(), { params });
    expect(res.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("404 when the order does not exist", async () => {
    mockFrom.mockReturnValue(orderChain({ data: null, error: { message: "no rows" } }));
    const res = await POST(createRequest(), { params });
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("400 when the order is not deleted", async () => {
    mockFrom.mockReturnValue(
      orderChain({ data: { id: ORDER_ID, status: "confirmed", market_id: "m-1" }, error: null }),
    );
    const res = await POST(createRequest(), { params });
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("recovers a deleted order to pending via the RPC", async () => {
    mockFrom.mockReturnValue(
      orderChain({ data: { id: ORDER_ID, status: "deleted", market_id: "m-1" }, error: null }),
    );
    mockRpc.mockResolvedValue({
      data: { recovered: true, order_id: ORDER_ID, status: "pending" },
      error: null,
    });

    const res = await POST(createRequest({ note: "client a rappelé" }), { params });
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("recover_deleted_order", {
      p_order_id: ORDER_ID,
      p_actor_id: "mgr-1",
      p_note: "client a rappelé",
    });
    const json = await res.json();
    expect(json.data.order.status).toBe("pending");
  });

  test("falls back to a default note when none is provided", async () => {
    mockFrom.mockReturnValue(
      orderChain({ data: { id: ORDER_ID, status: "deleted", market_id: "m-1" }, error: null }),
    );
    mockRpc.mockResolvedValue({ data: { recovered: true }, error: null });

    await POST(createRequest({}), { params });
    expect(mockRpc).toHaveBeenCalledWith(
      "recover_deleted_order",
      expect.objectContaining({ p_note: "Commande restaurée" }),
    );
  });

  test("409 when the RPC rejects a scanned-deletion (check_violation)", async () => {
    mockFrom.mockReturnValue(
      orderChain({ data: { id: ORDER_ID, status: "deleted", market_id: "m-1" }, error: null }),
    );
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "Order was scanned when deleted and cannot be recovered" },
    });

    const res = await POST(createRequest(), { params });
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.reason).toBe("not_recoverable");
  });
});
