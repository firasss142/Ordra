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
const get = (q: string) => GET(new NextRequest(new URL(`/api/feedback/days?${q}`, "http://localhost")));

beforeEach(() => {
  resetTestActor();
  setTestActor({ role: "market_manager", market_id: LY });
  fake = makeFakeSupabase({
    products: [
      { id: "bs", market_id: LY, name: "دميه ملاكمه حجم صغير", image_url: null, is_active: true, deleted_at: null },
      { id: "q", market_id: LY, name: "القرآن تدبر وعمل", image_url: null, is_active: true, deleted_at: null },
    ],
  });
  fake.rpcs.feedback_cube = () => [
    { day: "2026-09-12", product_id: "q" },
    { day: "2026-09-03", product_id: "bs" },
    { day: "2026-09-12", product_id: "bs" },
  ];
});

describe("GET /api/feedback/days — the calendar's dots", () => {
  test("distinct days, sorted, under the family filter", async () => {
    expect((await (await get("from=2026-08-01&to=2026-09-30")).json()).data).toEqual(["2026-09-03", "2026-09-12"]);
    expect((await (await get("from=2026-08-01&to=2026-09-30&family=q")).json()).data).toEqual(["2026-09-12"]);
  });
  test("no more than two months; agents refused", async () => {
    expect((await get("from=2026-01-01&to=2026-09-30")).status).toBe(400);
    setTestActor({ role: "agent", market_id: LY });
    expect((await get("from=2026-08-01&to=2026-09-30")).status).toBe(403);
  });
});
