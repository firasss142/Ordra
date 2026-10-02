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

import { GET } from "./route";

const LY_ORDER = "11111111-1111-4111-8111-111111111111";
const TN_ORDER = "22222222-2222-4222-8222-222222222222";

const call = (id: string) =>
  GET(new NextRequest(new URL(`http://localhost/api/agent/orders/${id}/preview`)), {
    params: Promise.resolve({ id }),
  });

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "agent-1", role: "agent", market_id: "m-ly" });
  fake = makeFakeSupabase({
    orders: [
      { id: LY_ORDER, market_id: "m-ly", status: "pending", assigned_to: null, external_id: "50240", total_price: 249, created_at: "2026-10-01T11:58:00Z", archived_at: null },
      { id: TN_ORDER, market_id: "m-tn", status: "pending", assigned_to: null, created_at: "2026-10-01T11:58:00Z", archived_at: null },
    ],
    order_items: [],
    order_history: [],
    users: [],
    carriers: [],
  });
});

describe("GET /api/agent/orders/[id]/preview", () => {
  test("401 without a session", async () => {
    setTestActor(null);
    expect((await call(LY_ORDER)).status).toBe(401);
  });

  test("403 for anyone but an agent", async () => {
    setTestActor({ role: "market_manager", market_id: "m-ly" });
    expect((await call(LY_ORDER)).status).toBe(403);
  });

  test("404 for an id that is not a uuid, before touching the database", async () => {
    expect((await call("not-an-id")).status).toBe(404);
  });

  test("404 for an order of another market — it does not exist for this agent", async () => {
    expect((await call(TN_ORDER)).status).toBe(404);
  });

  test("returns the read-only snapshot, never cached", async () => {
    const res = await call(LY_ORDER);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const { data } = await res.json();
    expect(data).toMatchObject({ id: LY_ORDER, external_id: "50240", owner: "none", access: "view" });
  });

  test("writes nothing — no presence, no history, no audit row", async () => {
    await call(LY_ORDER);
    expect(fake.log).toEqual([]);
  });
});
