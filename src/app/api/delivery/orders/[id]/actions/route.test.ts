import { describe, test, expect, vi, beforeEach } from "vitest";

const mockRpc = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ rpc: (...args: unknown[]) => mockRpc(...args) }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { POST } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const ORDER = "94b08126-33e9-45a0-aec7-f98b57cf84f1";
const post = (body: unknown, id = ORDER) =>
  POST(
    new NextRequest(new URL(`http://localhost:3000/api/delivery/orders/${id}/actions`), {
      method: "POST",
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: { id } },
  );
const as = (id: string, role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id, role, market_id } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: { id: "act1", outcome: "no_answer" }, error: null });
});

describe("POST /api/delivery/orders/[id]/actions", () => {
  test("warehouse agents cannot record delivery actions", async () => {
    as("w", "warehouse_agent", LY);
    expect((await post({ action_type: "note", note: "x" })).status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("a bad order id or body is a 400 before any database call", async () => {
    as("a1", "agent", LY);
    expect((await post({ action_type: "note", note: "x" }, "nope")).status).toBe(400);
    expect((await post("{not json")).status).toBe(400);
    const res = await post({ action_type: "call_courier", outcome: "reached_will_receive" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_outcome");
    expect(mockRpc).not.toHaveBeenCalled();
  });

  test("an agent records as themselves, labelled agent", async () => {
    as("a1", "agent", LY);
    const res = await post({ action_type: "call_customer", outcome: "no_answer", note: "x", actor_id: "someone" });
    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith("record_delivery_action", {
      p_order_id: ORDER,
      p_action_type: "call_customer",
      p_channel: "phone",
      p_outcome: "no_answer",
      p_note: "x",
      p_next_action_at: null,
      p_template_key: null,
      p_actor_id: "a1",
      p_actor_type: "agent",
    });
    expect((await res.json()).data.id).toBe("act1");
  });

  test("managers and super admins are labelled manager", async () => {
    as("m", "market_manager", LY);
    await post({ action_type: "note", note: "vu avec l'agence" });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_actor_id: "m", p_actor_type: "manager" });
    as("s", "super_admin", null);
    await post({ action_type: "note", note: "ok" });
    expect(mockRpc.mock.calls[1][1]).toMatchObject({ p_actor_id: "s", p_actor_type: "manager" });
  });

  test("database refusals map to honest statuses", async () => {
    as("a1", "agent", LY);
    const body = { action_type: "call_customer", outcome: "no_answer" };

    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "not_your_order" } });
    expect((await post(body)).status).toBe(403);

    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "order_not_found" } });
    expect((await post(body)).status).toBe(404);

    mockRpc.mockResolvedValueOnce({
      data: null,
      error: { code: "22023", message: "order_out_of_delivery_scope", details: '{"code":"OUT_OF_SCOPE","status":"pending"}' },
    });
    const scoped = await post(body);
    expect(scoped.status).toBe(409);
    expect((await scoped.json()).error).toBe("out_of_scope");

    mockRpc.mockResolvedValueOnce({ data: null, error: { code: "XX000", message: "boom" } });
    expect((await post(body)).status).toBe(500);
  });
});
