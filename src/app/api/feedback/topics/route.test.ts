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
const get = (q = "") => GET(new NextRequest(new URL(`/api/feedback/topics${q}`, "http://localhost")));
const t = (id: string, market_id: string, category: string, sort_order: number, is_active = true) =>
  ({ id, market_id, category, key: id, label_fr: id, label_ar: id, sort_order, is_active });

beforeEach(() => {
  resetTestActor();
  fake = makeFakeSupabase({
    feedback_topics: [
      t("card", LY, "objection", 2), t("nocash", LY, "objection", 1), t("never", LY, "reclamation", 2),
      t("retired", LY, "objection", 0, false), t("tn-only", TN, "objection", 0),
    ],
  });
});

describe("GET /api/feedback/topics", () => {
  test("the market's active topics, in their order", async () => {
    setTestActor({ role: "agent", market_id: LY });
    const { data } = await (await get()).json();
    expect(data.map((x: { id: string }) => x.id)).toEqual(["never", "nocash", "card"]);
    expect(Object.keys(data[0]).sort()).toEqual(["category", "id", "key", "label_ar", "label_fr", "sort_order"]);
  });

  test("super_admin names the market; without it, a 400", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await get()).status).toBe(400);
    const { data } = await (await get(`?market_id=${TN}`)).json();
    expect(data.map((x: { id: string }) => x.id)).toEqual(["tn-only"]);
  });
});
