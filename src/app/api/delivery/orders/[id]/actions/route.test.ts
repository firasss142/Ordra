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

// Voix du client: « Veut annuler » / « Retour confirmé » offer to keep why (agent prototype v2,
// screen ③). The action is the record; the entry rides along and never blocks it.
describe("POST /api/delivery/orders/[id]/actions — the « Pourquoi ? » rider", () => {
  const TOPIC = "33333333-3333-4333-8333-333333333333";
  beforeEach(() => {
    mockRpc.mockImplementation(async (name: string) =>
      name === "create_customer_feedback"
        ? { data: "fb1", error: null }
        : { data: { id: "act1", outcome: "reached_wants_cancel" }, error: null });
  });

  test("wants to cancel + feedback → the note becomes a delivery-sourced entry, after the action", async () => {
    as("a1", "agent", LY);
    const res = await post({
      action_type: "call_customer", outcome: "reached_wants_cancel", note: "قال توا معنديش فلوس",
      feedback: { category: "objection", topic_id: TOPIC },
    });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ id: "act1", feedback_id: "fb1" });
    expect(mockRpc.mock.calls.map((c) => c[0])).toEqual(["record_delivery_action", "create_customer_feedback"]);
    expect(mockRpc).toHaveBeenLastCalledWith("create_customer_feedback", {
      p_category: "objection", p_body: "قال توا معنديش فلوس", p_topic_id: TOPIC, p_order_id: ORDER, p_source: "delivery",
    });
  });

  test("a return confirmed by the courier qualifies too", async () => {
    as("a1", "agent", LY);
    await post({ action_type: "call_courier", outcome: "return_confirmed", note: "مش نفس لي في نت", feedback: { category: "reclamation", topic_id: null } });
    expect(mockRpc.mock.calls.map((c) => c[0])).toContain("create_customer_feedback");
  });

  test("any other outcome, no words, or a failed entry: the action stands alone", async () => {
    as("a1", "agent", LY);
    await post({ action_type: "call_customer", outcome: "reached_will_receive", note: "x", feedback: { category: "objection" } });
    await post({ action_type: "call_customer", outcome: "reached_wants_cancel", feedback: { category: "objection" } });
    expect(mockRpc.mock.calls.map((c) => c[0])).not.toContain("create_customer_feedback");

    mockRpc.mockImplementation(async (name: string) =>
      name === "create_customer_feedback"
        ? { data: null, error: { code: "22023", message: "invalid_topic" } }
        : { data: { id: "act1" }, error: null });
    const res = await post({ action_type: "call_customer", outcome: "reached_wants_cancel", note: "غالي", feedback: { category: "objection", topic_id: TOPIC } });
    expect(res.status).toBe(201);
    expect((await res.json()).data).toMatchObject({ id: "act1", feedback_id: null });
  });
});
