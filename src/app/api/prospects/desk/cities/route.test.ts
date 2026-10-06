import { describe, test, expect, vi, beforeEach } from "vitest";

let result: { data: unknown; error: unknown } = { data: [], error: null };
const builder: Record<string, unknown> = {};
for (const m of ["select", "eq", "not", "limit"]) builder[m] = () => builder;
builder.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({ from: () => builder }) }));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
beforeEach(() => vi.clearAllMocks());

describe("GET /api/prospects/desk/cities", () => {
  test("the market's cities, most customers first, trimmed and deduped", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role: "market_manager", market_id: LY } } as never);
    result = { data: [{ last_city: "طرابلس" }, { last_city: " بنغازي " }, { last_city: "طرابلس" }, { last_city: "" }, { last_city: "بنغازي" }, { last_city: "طرابلس" }], error: null };
    const body = await (await GET(new NextRequest(new URL("http://localhost/api/prospects/desk/cities")))).json();
    expect(body).toEqual({ cities: ["طرابلس", "بنغازي"] });
  });

  test("refuses agents", async () => {
    vi.mocked(getActor).mockResolvedValue({ actor: { id: "a", role: "agent", market_id: LY } } as never);
    expect((await GET(new NextRequest(new URL("http://localhost/api/prospects/desk/cities")))).status).toBe(403);
  });
});
