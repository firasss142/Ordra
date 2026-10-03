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

import { GET, PATCH } from "./route";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";
const get = (qs = "") => GET(new NextRequest(new URL(`http://localhost/api/admin/warehouse-sites${qs}`)));

/**
 * Réglages › Entrepôts: the super_admin switches sites on and off; a market
 * manager reads their own market's sites (they used to get a 403 and an
 * empty « Aucun site »).
 */
beforeEach(() => {
  resetTestActor();
  db = makeFakeSupabase({
    warehouses: [
      { id: "w1", code: "tripoli", name_fr: "Tripoli", name_ar: "طرابلس", market_id: LY, is_default: true, is_active: true },
      { id: "w2", code: "benghazi", name_fr: "Benghazi", name_ar: "بنغازي", market_id: LY, is_default: false, is_active: true },
      { id: "w3", code: "tunis", name_fr: "Tunis", name_ar: "تونس", market_id: TN, is_default: true, is_active: true },
    ],
    users: [
      { id: "u1", full_name: "adel", warehouse_id: "w1", deleted_at: null },
      { id: "u2", full_name: "tarek", warehouse_id: "w2", deleted_at: null },
      { id: "u3", full_name: "ancien", warehouse_id: "w2", deleted_at: "2026-09-01T00:00:00Z" },
    ],
    product_site_stock: [{ warehouse_id: "w1", current_stock: 12 }],
  });
});

describe("GET /api/admin/warehouse-sites", () => {
  test("a market manager reads their own market's sites, whatever market they ask for", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const res = await get(`?market_id=${TN}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.map((s: { id: string }) => s.id)).toEqual(["w1", "w2"]);
  });

  test("a soft-deleted user is not counted as an agent of the site", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const { data } = await (await get(`?market_id=${LY}`)).json();
    const benghazi = data.find((s: { id: string }) => s.id === "w2");
    expect(benghazi.assignedAgents).toEqual([{ id: "u2", name: "tarek" }]);
  });

  test("an agent is refused", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await get()).status).toBe(403);
  });
});

describe("PATCH /api/admin/warehouse-sites", () => {
  test("a market manager cannot switch a site", async () => {
    setTestActor({ role: "market_manager", market_id: LY });
    const res = await PATCH(new NextRequest(new URL("http://localhost/api/admin/warehouse-sites"), { method: "PATCH", body: JSON.stringify({ id: "w2", is_active: false }) }));
    expect(res.status).toBe(403);
  });
});
