import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (t: string) => mockFrom(t),
    rpc: (fn: string, args: unknown) => mockRpc(fn, args),
  }),
}));

import { PUT } from "./route";
import { AGENT_BRIEF_MAX } from "@/lib/products/agent-content-limits";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn(() => c);
  c.eq = vi.fn(() => c);
  c.single = vi.fn(async () => ({ data, error }));
  return c;
}

function req(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/products/p-1/agent-content"), {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: "p-1" }) };

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockFrom.mockImplementation(() => chain({ id: "p-1", market_id: "m-tn" }));
  mockRpc.mockResolvedValue({ data: null, error: null });
});

describe("PUT agent-content — permissions", () => {
  test("market_manager can write content in their own market", async () => {
    setTestActor({ id: "mgr", role: "market_manager", market_id: "m-tn" });
    const res = await PUT(req({ agent_brief: "Stock bleu épuisé" }), params);
    expect(res.status).toBe(200);
  });

  test("market_manager cannot write content in another market", async () => {
    setTestActor({ id: "mgr", role: "market_manager", market_id: "m-ly" });
    const res = await PUT(req({ agent_brief: "x" }), params);
    expect(res.status).toBe(403);
  });

  test("super_admin can write cross-market", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    const res = await PUT(req({ agent_brief: "x" }), params);
    expect(res.status).toBe(200);
  });

  test("agent is forbidden", async () => {
    setTestActor({ id: "a", role: "agent", market_id: "m-tn" });
    const res = await PUT(req({ agent_brief: "x" }), params);
    expect(res.status).toBe(403);
  });

  test("warehouse_agent is forbidden", async () => {
    setTestActor({ id: "w", role: "warehouse_agent", market_id: "m-tn" });
    const res = await PUT(req({ agent_brief: "x" }), params);
    expect(res.status).toBe(403);
  });

  test("missing product is 404", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    mockFrom.mockImplementation(() => chain(null, { message: "no rows" }));
    const res = await PUT(req({ agent_brief: "x" }), params);
    expect(res.status).toBe(404);
  });
});

describe("PUT agent-content — never touches costs or stock", () => {
  test("routes through the content RPC, not a direct products update", async () => {
    setTestActor({ id: "mgr", role: "market_manager", market_id: "m-tn" });
    await PUT(req({ agent_brief: "x", unit_cogs: 999, current_stock: 500 }), params);

    const [fn, args] = mockRpc.mock.calls[0];
    expect(fn).toBe("update_product_agent_content");
    // Exact list, so a future field cannot be smuggled in without a decision.
    expect(Object.keys(args as object).sort()).toEqual(
      [
        "p_product_id",
        "p_description",
        "p_agent_brief",
        "p_agent_brief_tone",
        "p_agent_notes",
        "p_agent_composition",
        "p_agent_contraindications",
        "p_agent_usage",
        "p_cross_sell_product_id",
        "p_actor_id",
      ].sort(),
    );
    // floor_price is a pricing field — it must never reach this route's RPC.
    expect(Object.keys(args as object)).not.toContain("p_floor_price");
  });

  test("ignores cost fields smuggled into the body", async () => {
    setTestActor({ id: "mgr", role: "market_manager", market_id: "m-tn" });
    await PUT(req({ agent_brief: "x", unit_cogs: 999 }), params);
    const serialized = JSON.stringify(mockRpc.mock.calls);
    expect(serialized).not.toContain("999");
  });
});

describe("PUT agent-content — validation", () => {
  test("rejects a brief longer than the cap", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    const res = await PUT(req({ agent_brief: "a".repeat(AGENT_BRIEF_MAX + 1) }), params);
    expect(res.status).toBe(400);
  });

  test("accepts a brief exactly at the cap", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    const res = await PUT(req({ agent_brief: "a".repeat(AGENT_BRIEF_MAX) }), params);
    expect(res.status).toBe(200);
  });

  test("rejects an unknown tone", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    const res = await PUT(req({ agent_brief_tone: "danger" }), params);
    expect(res.status).toBe(400);
  });

  test("normalizes an empty brief to null so the banner disappears", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    await PUT(req({ agent_brief: "   " }), params);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_agent_brief: null });
  });

  test("trims surrounding whitespace", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    await PUT(req({ agent_brief: "  Pack 2 à 79  " }), params);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_agent_brief: "Pack 2 à 79" });
  });

  test("returns 400 on malformed JSON", async () => {
    setTestActor({ id: "sa", role: "super_admin", market_id: null });
    const bad = new NextRequest(new URL("http://localhost/api/products/p-1/agent-content"), {
      method: "PUT",
      body: "{not json",
    });
    expect((await PUT(bad, params)).status).toBe(400);
  });
});

describe("PUT agent-content — variant notes", () => {
  test("saves a note per pack tier", async () => {
    setTestActor({ id: "mgr", role: "market_manager", market_id: "m-tn" });
    await PUT(
      req({
        agent_brief: "x",
        variant_notes: [
          { id: "v-1", agent_note: "Meilleure marge" },
          { id: "v-2", agent_note: "" },
        ],
      }),
      params,
    );

    const variantCalls = mockRpc.mock.calls.filter((c) => c[0] === "update_variant_agent_note");
    expect(variantCalls).toHaveLength(2);
    expect(variantCalls[0][1]).toMatchObject({ p_variant_id: "v-1", p_agent_note: "Meilleure marge" });
    expect(variantCalls[1][1]).toMatchObject({ p_variant_id: "v-2", p_agent_note: null });
  });

  test("surfaces an RPC failure rather than reporting success", async () => {
    setTestActor({ id: "mgr", role: "market_manager", market_id: "m-tn" });
    mockRpc.mockImplementation(async (fn: string) =>
      fn === "update_variant_agent_note"
        ? { data: null, error: { message: "Market mismatch" } }
        : { data: null, error: null },
    );
    const res = await PUT(
      req({ variant_notes: [{ id: "v-1", agent_note: "x" }] }),
      params,
    );
    expect(res.status).toBe(422);
  });
});
