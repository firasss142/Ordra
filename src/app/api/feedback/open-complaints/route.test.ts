import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => fake.client) }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const get = () => GET(new NextRequest(new URL("/api/feedback/open-complaints", "http://localhost")));
const row = (id: string, over: Record<string, unknown>) => ({
  id, market_id: LY, category: "reclamation", status: "open", deleted_at: null, customer_id: "c1",
  customer: { phone_normalized: "926110387" }, ...over,
});

beforeEach(() => {
  resetTestActor();
  setTestActor({ id: "agent-1", role: "agent", market_id: LY });
  fake = makeFakeSupabase({
    customer_feedback: [
      row("a", {}),
      row("b", { status: "in_progress" }),
      row("c", { customer_id: "c2", customer: { phone_normalized: "912045518" }, status: "in_progress" }),
      row("d", { customer_id: "c3", customer: { phone_normalized: "911111111" }, status: "resolved" }),
      row("e", { customer_id: "c4", customer: { phone_normalized: "922222222" }, category: "objection", status: null }),
      row("f", { customer_id: "c5", customer: { phone_normalized: "933333333" }, deleted_at: "2026-09-30T00:00:00Z" }),
      row("g", { customer_id: "c6", customer: { phone_normalized: "944444444" }, market_id: TN }),
    ],
  });
});

describe("GET /api/feedback/open-complaints — the « 1 réclamation ouverte » on a queue row", () => {
  test("each customer with an open or in-progress complaint, counted once per customer", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: { "926110387": 2, "912045518": 1 } });
  });

  test("the warehouse gets nothing", async () => {
    setTestActor({ role: "warehouse_agent", market_id: LY });
    expect((await get()).status).toBe(403);
  });
});
