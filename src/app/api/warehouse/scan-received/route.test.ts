import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

/**
 * « Relivrer au client » — the third return decision, and a manager's.
 *
 * Sending a returned parcel back out is a commercial call, not a bench one
 * (decision of 2026-10-02, plans/entrepot-day-loop-redesign.md): the agent's
 * phone only has Intact / Abîmé. The route enforces it so the rule does not
 * rest on which buttons a screen happens to draw.
 */

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => fake.client),
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { POST } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

function req(body: unknown) {
  return new NextRequest(new URL("http://localhost/api/warehouse/scan-received"), {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

const calls: Array<Record<string, unknown>> = [];
beforeEach(() => {
  resetTestActor();
  calls.length = 0;
  fake = makeFakeSupabase();
  fake.rpcs.scan_received_in = (args) => {
    calls.push(args);
    return { success: true };
  };
});

describe("POST /api/warehouse/scan-received", () => {
  test("a manager redelivers: the RPC runs in their name", async () => {
    setTestActor({ id: "mm", role: "market_manager" });
    const res = await POST(req({ order_id: "o-1" }));
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ p_order_id: "o-1", p_actor_id: "mm" }]);
  });

  test("a warehouse agent cannot redeliver", async () => {
    setTestActor({ id: "adel", role: "warehouse_agent" });
    const res = await POST(req({ order_id: "o-1" }));
    expect(res.status).toBe(403);
    expect(calls).toEqual([]);
  });

  test("a confirmation agent cannot either", async () => {
    setTestActor({ id: "a1", role: "agent" });
    expect((await POST(req({ order_id: "o-1" }))).status).toBe(403);
  });

  test("an order id is required", async () => {
    setTestActor({ id: "mm", role: "market_manager" });
    expect((await POST(req({}))).status).toBe(400);
  });

  test("the RPC's refusal is passed through", async () => {
    setTestActor({ id: "mm", role: "market_manager" });
    fake.rpcs.scan_received_in = () => {
      throw new Error("Order is not in to_be_returned status (current: returning)");
    };
    const res = await POST(req({ order_id: "o-1" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatch(/to_be_returned/);
  });
});
