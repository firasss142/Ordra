import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";

let db: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET } from "./route";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";

/** Journaux › Commandes reçues and › Transporteurs can be narrowed to one market. */
beforeEach(() => {
  resetTestActor();
  setTestActor({ role: "super_admin", market_id: null });
  db = makeFakeSupabase({
    storefronts: [{ id: "s-ly", market_id: LY }, { id: "s-tn", market_id: TN }],
    carriers: [{ id: "c1", market_id: LY, code: "darb_assabil" }, { id: "c2", market_id: TN, code: "navex" }],
    webhook_delivery_log: [
      { id: "w1", storefront_id: "s-ly", status: "processed", created_at: "2026-10-02T10:00:00Z" },
      { id: "w2", storefront_id: "s-tn", status: "error", created_at: "2026-10-02T09:00:00Z" },
    ],
    carrier_event_log: [
      { id: "e1", carrier_code: "darb_assabil", outcome: "error", created_at: "2026-10-02T10:00:00Z" },
      { id: "e2", carrier_code: "navex", outcome: "error", created_at: "2026-10-02T09:00:00Z" },
    ],
  });
});

describe("Journaux — market filter", () => {
  test("orders received: only the shops of the market", async () => {
    const res = await GET(new NextRequest(new URL(`http://localhost/api/admin/webhook-logs?market_id=${TN}`)));
    const body = await res.json();
    expect(body.data.map((r: { id: string }) => r.id)).toEqual(["w2"]);
    expect(body.pagination.total).toBe(1);
  });

  test("a market with no shop returns nothing, not everything", async () => {
    const res = await GET(new NextRequest(new URL("http://localhost/api/admin/webhook-logs?market_id=none")));
    expect((await res.json()).data).toEqual([]);
  });
});
