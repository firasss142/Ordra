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

const req = (qs: string) => new NextRequest(new URL(`http://localhost/api/agent/search?${qs}`));

function order(id: string, market_id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    market_id,
    external_id: id,
    status: "pending",
    assigned_to: null,
    customer_name: "Salima Ben Ali",
    customer_phone: "0925782017",
    customer_phone_2: null,
    customer_city: "Tripoli",
    customer_address: null,
    product_name: "Book",
    variant_label: null,
    total_price: 200,
    currency: "LYD",
    tracking_number: null,
    created_at: "2026-09-30T10:00:00Z",
    archived_at: null,
    ...over,
  };
}

beforeEach(() => {
  resetTestActor();
  fake = makeFakeSupabase({
    orders: [order("ly-1", "m-ly"), order("tn-1", "m-tn")],
    users: [],
  });
});

describe("GET /api/agent/search", () => {
  test("401 without a session", async () => {
    setTestActor(null);
    expect((await GET(req("q=salima"))).status).toBe(401);
  });

  test("403 for anyone but an agent — managers have the Orders page", async () => {
    setTestActor({ role: "market_manager", market_id: "m-ly" });
    expect((await GET(req("q=salima"))).status).toBe(403);
  });

  test("403 for an agent with no market, rather than searching every market", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: null });
    expect((await GET(req("q=salima"))).status).toBe(403);
  });

  test("400 below three characters", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-ly" });
    expect((await GET(req("q=sa"))).status).toBe(400);
  });

  test("searches the agent's own market, whatever market the request names", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-ly" });
    const res = await GET(req("q=salima&market_id=m-tn"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.rows.map((r: { id: string }) => r.id)).toEqual(["ly-1"]);
    expect(json.total).toBe(1);
    expect(json.rows[0]).toMatchObject({ owner: "none", access: "view" });
  });

  test("is never cached: the answer depends on who asks and changes by the minute", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-ly" });
    const res = await GET(req("q=salima"));
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  test("500 when the database fails, without leaking the error text", async () => {
    setTestActor({ id: "agent-1", role: "agent", market_id: "m-ly" });
    fake.failNext("orders", { message: "relation secret_internal does not exist" });
    const res = await GET(req("q=salima"));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secret_internal");
  });
});
