import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({ from: (...a: unknown[]) => mockFrom(...a) }) }));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));

import { GET } from "./route";
import { NextRequest } from "next/server";

const M = "00000000-0000-0000-0000-000000000002";
const req = (qs = "") => new NextRequest(new URL(`http://localhost:3000/api/orders/archive/counts${qs}`));

/** Each orders query resolves to a count decided by its filters. */
function db(ruleDays: unknown) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "settings") {
      const c: Record<string, unknown> = {};
      c.select = () => c;
      c.eq = () => c;
      c.single = () => Promise.resolve({ data: ruleDays === undefined ? null : { value: ruleDays } });
      return c;
    }
    const calls: unknown[][] = [];
    const c: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "in", "is", "not", "or", "gte", "lt", "lte"]) c[m] = (...a: unknown[]) => (calls.push([m, ...a]), c);
    c.then = (fn: (v: unknown) => unknown) => {
      const has = (m: string, ...a: unknown[]) => calls.some((x) => x[0] === m && JSON.stringify(x.slice(1)) === JSON.stringify(a));
      const count = has("eq", "status", "deleted") ? 4 : has("not", "archived_at", "is", null) ? 30 : calls.some((x) => x[0] === "lt") ? 12 : 7;
      return Promise.resolve({ count, error: null }).then(fn);
    };
    return c;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetActor.mockResolvedValue({ actor: { id: "m", role: "market_manager", market_id: M } });
});

describe("GET /api/orders/archive/counts", () => {
  test("counts each tab and says whether the rule is on", async () => {
    db(30);
    const body = await (await GET(req())).json();
    expect(body.data).toEqual({ eligible: 12, archived: 30, recent: 7, deleted: 4, finished: 49, rule_days: 30 });
  });

  test("a rule set to 0 is off", async () => {
    db(0);
    expect((await (await GET(req())).json()).data.rule_days).toBe(0);
  });

  test("agents are refused", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a", role: "agent", market_id: M } });
    db(30);
    expect((await GET(req())).status).toBe(403);
  });
});
