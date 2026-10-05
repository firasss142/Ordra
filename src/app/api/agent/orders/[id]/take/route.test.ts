import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => fake.client,
  createClient: vi.fn(),
}));

import { POST } from "./route";

const ID = "0cae8e2a-f1e4-4f10-a39b-685f8ed55014";
const call = (id = ID) => POST(new NextRequest(new URL(`http://localhost/api/agent/orders/${id}/take`), { method: "POST" }), { params: Promise.resolve({ id }) });

let assigned: Record<string, unknown>[];
function seed(over: Record<string, unknown> = {}) {
  fake = makeFakeSupabase({ orders: [{ id: ID, market_id: "m-ly", status: "confirmed", assigned_to: "u-other", ...over }] });
  assigned = [];
  fake.rpcs.assign_order = (args) => {
    assigned.push(args);
    return { order_id: ID, assigned_to: args.p_agent_id };
  };
}

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "u-me", role: "agent", market_id: "m-ly" });
  seed();
});

describe("POST /api/agent/orders/[id]/take", () => {
  test("an agent takes a colleague's order of their market — recorded as the agent's own act", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(assigned).toEqual([expect.objectContaining({ p_order_id: ID, p_agent_id: "u-me", p_actor_id: "u-me", p_actor_type: "agent" })]);
  });

  test("never across markets, never for a manager", async () => {
    seed({ market_id: "m-tn" });
    expect((await call()).status).toBe(404);
    setTestActor({ id: "u-m", role: "market_manager", market_id: "m-ly" });
    expect((await call()).status).toBe(403);
    expect(assigned).toHaveLength(0);
  });

  test("a settled order stays where it is", async () => {
    for (const status of ["delivered", "returned", "cancelled", "deleted"]) {
      seed({ status });
      expect((await call()).status).toBe(409);
    }
  });

  test("already mine: nothing to write", async () => {
    seed({ assigned_to: "u-me" });
    expect((await call()).status).toBe(200);
    expect(assigned).toHaveLength(0);
  });
});
