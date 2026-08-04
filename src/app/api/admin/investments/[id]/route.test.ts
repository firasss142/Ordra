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

const POSITION = {
  id: "pos-1",
  investor_id: "inv-1",
  product_id: "prod-1",
  market_id: "m-tn",
  amount: 20000,
  effective_from: "2026-03-01",
  effective_to: null,
  status: "active",
};

const req = (body: unknown) =>
  new NextRequest(new URL("http://localhost/api/admin/investments/pos-1"), {
    method: "PATCH",
    body: JSON.stringify(body),
  });

const params = Promise.resolve({ id: "pos-1" });

function mockPosition(position: unknown = POSITION) {
  const update = vi.fn().mockReturnValue(chain({ ...POSITION, status: "closed" }));
  mockFrom.mockImplementation(() => ({ ...chain(position), update }));
  return update;
}

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
});

describe("PATCH capital position — closing", () => {
  test("end-dates the position and marks it closed", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const update = mockPosition();

    const res = await PATCH(req({ effective_to: "2026-06-30" }), { params });

    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ effective_to: "2026-06-30", status: "closed" })
    );
  });

  test("refuses an end date before the start date", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockPosition();
    const res = await PATCH(req({ effective_to: "2026-02-01" }), { params });
    expect(res.status).toBe(422);
  });

  test("allows an end date equal to the start date", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockPosition();
    expect((await PATCH(req({ effective_to: "2026-03-01" }), { params })).status).toBe(200);
  });

  test("rejects a malformed date", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await PATCH(req({ effective_to: "30/06/2026" }), { params })).status).toBe(400);
  });

  /**
   * Capital amounts are historical inputs to statements that may already be
   * settled and paid. Editing one would silently change what an investor was
   * owed for a closed period, and the ledger cannot be walked back.
   */
  test("never edits the capital amount", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const update = mockPosition();

    await PATCH(req({ effective_to: "2026-06-30", amount: 999999 }), { params });

    expect(update.mock.calls[0][0]).not.toHaveProperty("amount");
  });

  test("never moves the position to another investor or product", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const update = mockPosition();

    await PATCH(
      req({ effective_to: "2026-06-30", investor_id: "inv-2", product_id: "prod-9" }),
      { params }
    );

    const patch = update.mock.calls[0][0] as Record<string, unknown>;
    expect(patch).not.toHaveProperty("investor_id");
    expect(patch).not.toHaveProperty("product_id");
    expect(patch).not.toHaveProperty("effective_from");
  });

  test("refuses to close an already closed position", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockPosition({ ...POSITION, status: "closed", effective_to: "2026-05-01" });
    expect((await PATCH(req({ effective_to: "2026-06-30" }), { params })).status).toBe(409);
  });

  test("404s for an unknown position", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    mockFrom.mockImplementation(() => chain(null));
    expect((await PATCH(req({ effective_to: "2026-06-30" }), { params })).status).toBe(404);
  });

  test("requires an end date", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    expect((await PATCH(req({}), { params })).status).toBe(400);
  });

  test("a market_manager cannot close a position", async () => {
    setTestActor({ role: "market_manager", market_id: "m-tn" });
    expect((await PATCH(req({ effective_to: "2026-06-30" }), { params })).status).toBe(403);
  });
});
