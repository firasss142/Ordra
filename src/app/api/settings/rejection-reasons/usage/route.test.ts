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
const get = (qs = "") => GET(new NextRequest(new URL(`http://localhost:3000/api/settings/rejection-reasons/usage${qs}`)));

/**
 * Réglages › Motifs de rejet shows how many orders carry each sub-reason — the
 * same count the delete rule uses (used → retired, unused → deleted).
 */
beforeEach(() => {
  resetTestActor();
  db = makeFakeSupabase({
    rejection_reason_configs: [
      { id: "g", market_id: LY, parent_key: null, key: "injoignable" },
      { id: "a", market_id: LY, parent_key: "injoignable", key: "pas_de_reponse" },
      { id: "b", market_id: LY, parent_key: "injoignable", key: "raccroche" },
      { id: "c", market_id: TN, parent_key: "injoignable", key: "pas_de_reponse" },
    ],
    orders: [
      { id: "1", market_id: LY, rejection_subreason: "pas_de_reponse" },
      { id: "2", market_id: LY, rejection_subreason: "pas_de_reponse" },
      { id: "3", market_id: TN, rejection_subreason: "pas_de_reponse" },
      { id: "4", market_id: LY, rejection_subreason: null },
    ],
  });
});

describe("GET /api/settings/rejection-reasons/usage", () => {
  test("counts the market's orders per sub-reason, zero included", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await get(`?market_id=${LY}`);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ pas_de_reponse: 2, raccroche: 0 });
  });

  test("a market manager reads their own market only", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    expect((await (await get()).json()).data).toEqual({ pas_de_reponse: 1 });
    expect((await get(`?market_id=${LY}`)).status).toBe(403);
  });

  test("a super_admin must name the market", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await get()).status).toBe(400);
  });

  test("an agent is refused", async () => {
    setTestActor({ role: "agent", market_id: LY });
    expect((await get()).status).toBe(403);
  });
});
