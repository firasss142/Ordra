import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({ from: (...a: unknown[]) => mockFrom(...a) }),
}));

import { PATCH } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

function chain(data: unknown, error: unknown = null) {
  const c: Record<string, unknown> = {};
  for (const m of ["select", "eq", "update"]) c[m] = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data, error });
  c.maybeSingle = vi.fn().mockResolvedValue({ data, error });
  c.then = (res: (v: unknown) => unknown) => res({ data, error });
  return c;
}

const req = (body: unknown) =>
  new NextRequest(new URL("http://localhost/api/admin/investments/investors/inv-1"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const params = Promise.resolve({ id: "inv-1" });

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
});

describe("PATCH investor profile", () => {
  test("updates the editable commercial terms", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const update = vi.fn().mockReturnValue(chain({ id: "inv-1", legal_name: "New Ltd" }));
    mockFrom.mockImplementation(() => ({ ...chain({ id: "inv-1" }), update }));

    const res = await PATCH(
      req({ legal_name: "New Ltd", reserve_pct: 15, payout_method: "cash" }),
      { params }
    );

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ legal_name: "New Ltd", reserve_pct: 15, payout_method: "cash" })
    );
  });

  test("ignores fields that are not editable", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const update = vi.fn().mockReturnValue(chain({ id: "inv-1" }));
    mockFrom.mockImplementation(() => ({ ...chain({ id: "inv-1" }), update }));

    await PATCH(req({ id: "someone-else", legal_name: "X", created_at: "2020-01-01" }), {
      params,
    });

    const patch = update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("created_at");
  });

  test("rejects an empty legal name", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await PATCH(req({ legal_name: "   " }), { params })).status).toBe(400);
  });

  test.each([[-0.01], [100.01]])("rejects reserve_pct %s", async (pct) => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await PATCH(req({ reserve_pct: pct }), { params })).status).toBe(400);
  });

  test("accepts the reserve_pct boundaries", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const update = vi.fn().mockReturnValue(chain({ id: "inv-1" }));
    mockFrom.mockImplementation(() => ({ ...chain({ id: "inv-1" }), update }));
    expect((await PATCH(req({ reserve_pct: 0 }), { params })).status).toBe(200);
    expect((await PATCH(req({ reserve_pct: 100 }), { params })).status).toBe(200);
  });

  test("rejects a request with nothing to change", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await PATCH(req({}), { params })).status).toBe(400);
  });

  test("404s for an unknown investor", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockFrom.mockImplementation(() => chain(null));
    expect((await PATCH(req({ legal_name: "X" }), { params })).status).toBe(404);
  });

  test("a market_manager cannot edit", async () => {
    setTestActor({ role: "market_manager", market_id: "m-tn" });
    expect((await PATCH(req({ legal_name: "X" }), { params })).status).toBe(403);
  });

  test("an investor cannot edit their own terms", async () => {
    setTestActor({ role: "investor", market_id: "m-tn" });
    expect((await PATCH(req({ reserve_pct: 0 }), { params })).status).toBe(403);
  });
});
