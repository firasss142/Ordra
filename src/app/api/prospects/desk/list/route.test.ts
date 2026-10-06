import { describe, test, expect, vi, beforeEach } from "vitest";

/** A PostgREST builder that records every call and resolves to `result`. */
const calls: [string, unknown[]][] = [];
let result: { data: unknown; error: unknown; count?: number } = { data: [], error: null, count: 0 };
const builder: Record<string, unknown> = {};
for (const m of ["select", "eq", "in", "is", "or", "order", "range", "limit"]) {
  builder[m] = (...a: unknown[]) => { calls.push([m, a]); return builder; };
}
builder.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ from: (t: string) => { calls.push(["from", [t]]); return builder; } }),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: vi.fn() }));

import { GET } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const A = "11111111-1111-4111-8111-111111111111";
const req = (q = "") => new NextRequest(new URL(`http://localhost:3000/api/prospects/desk/list${q}`));
const as = (role: string, market_id: string | null) =>
  vi.mocked(getActor).mockResolvedValue({ actor: { id: "m", role, market_id } } as never);
const called = (m: string) => calls.filter(([n]) => n === m).map(([, a]) => a);

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  result = { data: [], error: null, count: 0 };
});

describe("GET /api/prospects/desk/list", () => {
  test("refuses agents", async () => {
    as("agent", LY);
    expect((await GET(req())).status).toBe(403);
  });

  test("defaults: own market, open prospects, page 1 of 25", async () => {
    as("market_manager", LY);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(called("from")).toEqual([["leads"]]);
    expect(called("eq")).toContainEqual(["market_id", LY]);
    expect(called("in")).toContainEqual(["status", ["new", "assigned", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled", "qualified"]]);
    expect(called("is")).toContainEqual(["converted_order_id", null]);
    expect(called("range")).toEqual([[0, 24]]);
    expect(called("or")).toEqual([]);
    expect(await res.json()).toMatchObject({ rows: [], total: 0, page: 1, pageSize: 25 });
  });

  test("several sources, several agents and a search travel as ONE combined .or()", async () => {
    as("market_manager", LY);
    await GET(req(`?src=rej,ret&agent=none,${A}&q=أحمد&page=2`));
    expect(called("or")).toEqual([[
      `and(or(source.in.(rejected_order,winback)),or(assigned_to.is.null,assigned_to.in.(${A})),or(customer_name.ilike.*أحمد*,customer_phone.ilike.*أحمد*))`,
    ]]);
    expect(called("range")).toEqual([[25, 49]]);
  });

  test("« Ramenés » is converted OR won, ANDed with the other filters", async () => {
    as("market_manager", LY);
    await GET(req(`?state=won&agent=${A}`));
    expect(called("or")).toEqual([[`and(or(converted_order_id.not.is.null,status.eq.won),or(assigned_to.in.(${A})))`]]);
    expect(called("in")).toEqual([]);
  });

  test("maps rows and returns the exact count", async () => {
    as("market_manager", LY);
    result = { data: [{ id: "l1", status: "new", source: "winback", customer_name: "x", customer_phone: "1", created_at: "2026-10-05T00:00:00Z" }], error: null, count: 71 };
    const body = await (await GET(req())).json();
    expect(body.total).toBe(71);
    expect(body.rows[0]).toMatchObject({ id: "l1", source: "ret", state: "to_call" });
  });

  test("one prospect by id, whatever its state", async () => {
    as("market_manager", LY);
    await GET(req(`?id=${A}`));
    expect(called("eq")).toContainEqual(["id", A]);
    expect(called("in")).toEqual([]);
  });

  test("a query error is a 500", async () => {
    as("market_manager", LY);
    result = { data: null, error: { message: "boom" } };
    expect((await GET(req())).status).toBe(500);
  });
});
