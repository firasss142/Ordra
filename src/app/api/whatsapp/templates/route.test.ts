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

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const req = (qs = "") => new NextRequest(new URL(`http://localhost:3000/api/whatsapp/templates${qs}`), { method: "GET" });

beforeEach(() => {
  resetTestActor();
  fake = makeFakeSupabase({
    whatsapp_templates: [
      { id: "t1", market_id: TN, name: "ordra_shipped_v1", language: "fr", status: "APPROVED", event_key: "shipped", created_at: "2026-09-25T01:00:00Z" },
      { id: "t2", market_id: LY, name: "ordra_shipped_v1", language: "ar", status: "PENDING", event_key: "shipped", created_at: "2026-09-25T02:00:00Z" },
    ],
  });
});

describe("GET /api/whatsapp/templates", () => {
  test("market_manager gets their own market only, whatever they ask for", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const res = await GET(req(`?market_id=${TN}`));
    expect(res.status).toBe(200);
    expect((await res.json()).data.map((t: { id: string }) => t.id)).toEqual(["t2"]);
  });

  test("super_admin must name a market", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await GET(req())).status).toBe(400);
    const res = await GET(req(`?market_id=${TN}`));
    expect((await res.json()).data.map((t: { id: string }) => t.id)).toEqual(["t1"]);
  });

  test("a campaign template carries its campaign's name, for the « Campagne · … » chip", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    fake.tables.whatsapp_templates.push(
      { id: "t3", market_id: TN, name: "ordra_camp_serum_260925", language: "ar", status: "PENDING", event_key: null, source: "campaign", campaign_id: "camp-1", created_at: "2026-09-25T03:00:00Z" },
    );
    fake.tables.prospect_campaigns = [
      { id: "camp-1", market_id: TN, name: "Sérum · clients 60–120 j" },
      { id: "camp-2", market_id: LY, name: "Montre X2 · Benghazi" },
    ];
    const { data } = await (await GET(req(`?market_id=${TN}`))).json();
    expect(data.find((t: { id: string }) => t.id === "t3").campaign_name).toBe("Sérum · clients 60–120 j");
    expect(data.find((t: { id: string }) => t.id === "t1").campaign_name).toBeNull();
  });

  test("agents read their market's list too (the composer needs it), warehouse does not", async () => {
    setTestActor({ role: "agent", market_id: TN });
    expect((await GET(req())).status).toBe(200);
    setTestActor({ role: "warehouse_agent", market_id: TN });
    expect((await GET(req())).status).toBe(403);
  });
});
