import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

let fake: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => fake.client,
  createClient: async () => fake.client,
}));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";

/**
 * « Rattacher à » — before anything is typed, the manager sees the market's
 * most recent live orders and open prospects (the conversation usually
 * belongs to one of them); a prospect row names its campaign.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const req = (qs: string) => new NextRequest(new URL(`http://localhost:3000/api/whatsapp/claim-search${qs}`), { method: "GET" });

const order = (id: string, over: Record<string, unknown> = {}) => ({
  id, market_id: LY, external_id: id.replace("o-", ""), customer_name: "ام الحارث", customer_phone: "0935897986", customer_city: "الكفرة", status: "pending", created_at: `2026-09-25T0${id.length % 9}:00:00Z`, ...over,
});

beforeEach(() => {
  resetTestActor();
  fake = makeFakeSupabase({
    orders: [
      order("o-1", { created_at: "2026-09-25T08:00:00Z" }),
      order("o-2", { created_at: "2026-09-25T09:00:00Z" }),
      order("o-3", { status: "delivered", created_at: "2026-09-25T10:00:00Z" }),
      order("o-tn", { market_id: TN, created_at: "2026-09-25T11:00:00Z" }),
    ],
    leads: [
      { id: "l-1", market_id: LY, customer_name: "سعاد الفيتوري", customer_phone: "0911234567", customer_city: "طرابلس", status: "new", campaign_id: "camp-1", created_at: "2026-09-25T07:00:00Z" },
      { id: "l-2", market_id: LY, customer_name: "Ali", customer_phone: "0917654321", customer_city: null, status: "won", campaign_id: null, created_at: "2026-09-25T09:30:00Z" },
    ],
    prospect_campaigns: [{ id: "camp-1", market_id: LY, name: "Sérum · clients 60–120 j" }],
  });
  // The shared fake has no `not(col, "in", "(a,b)")`; emulate PostgREST's
  // meaning here (every value excluded) rather than widen the helper.
  const from = fake.client.from;
  fake.client.from = (table: string) => {
    const chain = from(table);
    const not = chain.not.bind(chain);
    chain.not = ((col: string, op: string, v: unknown) => {
      if (op !== "in") return not(col, op, v);
      for (const x of String(v).replace(/[()]/g, "").split(",")) chain.neq(col, x);
      return chain;
    }) as typeof chain.not;
    return chain;
  };
});

describe("GET /api/whatsapp/claim-search", () => {
  test("with nothing typed: the market's recent live orders and open prospects, newest first", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const res = await GET(req(`?market_id=${LY}`));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.orders.map((o: { id: string }) => o.id)).toEqual(["o-2", "o-1"]);
    expect(data.leads.map((l: { id: string }) => l.id)).toEqual(["l-1"]);
  });

  test("a prospect carries its campaign's name", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const { data } = await (await GET(req(`?market_id=${LY}`))).json();
    expect(data.leads[0].campaign_name).toBe("Sérum · clients 60–120 j");
  });

  test("a manager never searches another market; agents never search", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    expect((await GET(req(`?market_id=${TN}`))).status).toBe(403);
    setTestActor({ role: "agent", market_id: LY });
    expect((await GET(req(`?market_id=${LY}`))).status).toBe(403);
  });
});
