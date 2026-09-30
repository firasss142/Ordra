import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: vi.fn(),
}));

import { GET, PATCH, DELETE } from "./route";
import { getActor } from "@/lib/auth/actor";
import { NextRequest } from "next/server";

const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";

function req(method: string, body?: unknown) {
  const init: { method: string; body?: string } = { method };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new NextRequest(
    new URL("/api/settings/rejection-reasons/r1", "http://localhost:3000"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    init as any,
  );
}

const params = { params: Promise.resolve({ id: "r1" }) };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asActor = (a: unknown) => ({ actor: a }) as any;
const superAdmin = asActor({ id: "u1", role: "super_admin", market_id: null });
const tnManager = asActor({ id: "u2", role: "market_manager", market_id: TN });
const tnAgent = asActor({ id: "u3", role: "agent", market_id: TN });

const SUBREASON = {
  id: "r1",
  market_id: TN,
  parent_key: "injoignable",
  key: "raccroche",
  is_active: true,
};
const GROUP = {
  id: "r1",
  market_id: TN,
  parent_key: null,
  key: "injoignable",
  is_active: true,
};

/**
 * `rejection_reason_configs` reads/writes and the `orders` usage count go
 * through the same `from()` mock, so each test says what each table returns.
 */
function setup({
  row,
  usage = 0,
  updated = { id: "r1" },
  updateError = null as unknown,
}: {
  row: unknown;
  usage?: number;
  updated?: unknown;
  updateError?: unknown;
}) {
  const configChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    single: vi
      .fn()
      .mockResolvedValueOnce({ data: row, error: null })
      .mockResolvedValue({ data: updated, error: updateError }),
  };
  const ordersChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ count: usage, error: null }),
  };

  mockFrom.mockImplementation((table: string) =>
    table === "orders" ? ordersChain : configChain,
  );
  return { configChain, ordersChain };
}

beforeEach(() => vi.clearAllMocks());

describe("GET /api/settings/rejection-reasons/[id]", () => {
  // The delete dialog has to say "213 commandes utilisent ce motif" *before*
  // the manager commits, so the count is readable on its own.
  test("returns the row with how many orders use it", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: SUBREASON, usage: 213 });

    const res = await GET(req("GET"), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.usage).toBe(213);
    expect(body.data.key).toBe("raccroche");
  });

  test("404 for an unknown id", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: null });

    expect((await GET(req("GET"), params)).status).toBe(404);
  });
});

describe("PATCH /api/settings/rejection-reasons/[id]", () => {
  test("403 for an agent", async () => {
    vi.mocked(getActor).mockResolvedValue(tnAgent);
    expect((await PATCH(req("PATCH", { label_fr: "x" }), params)).status).toBe(
      403,
    );
  });

  test("403 when a manager edits another market's taxonomy", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: { ...SUBREASON, market_id: LY } });

    expect((await PATCH(req("PATCH", { label_fr: "x" }), params)).status).toBe(
      403,
    );
  });

  test("renames a sub-reason and updates both label lengths", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    const { configChain } = setup({ row: SUBREASON });

    const res = await PATCH(
      req("PATCH", {
        label_fr: "Raccroche au téléphone",
        short_fr: "Raccroche",
      }),
      params,
    );

    expect(res.status).toBe(200);
    expect(configChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        label_fr: "Raccroche au téléphone",
        short_fr: "Raccroche",
      }),
    );
  });

  // The key is written into orders.rejection_subreason; renaming it would
  // orphan every row that carries it.
  test("400 when the key or the parent is touched", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: SUBREASON });

    expect((await PATCH(req("PATCH", { key: "autre_nom" }), params)).status).toBe(
      400,
    );
    setup({ row: SUBREASON });
    expect(
      (await PATCH(req("PATCH", { parent_key: "refus_client" }), params)).status,
    ).toBe(400);
  });

  test("recolours a group", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    const { configChain } = setup({ row: GROUP });

    const res = await PATCH(req("PATCH", { hue: "violet" }), params);

    expect(res.status).toBe(200);
    expect(configChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ hue: "violet" }),
    );
  });

  test("400 on a hue outside the six named ones", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: GROUP });

    expect((await PATCH(req("PATCH", { hue: "#ff0000" }), params)).status).toBe(
      400,
    );
  });

  // A sub-reason inherits its group's colour — that is what keeps one group one
  // colour down a thousand rows.
  test("400 when recolouring a sub-reason", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: SUBREASON });

    expect((await PATCH(req("PATCH", { hue: "green" }), params)).status).toBe(
      400,
    );
  });

  test("400 when no mutable field is sent", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: SUBREASON });

    expect((await PATCH(req("PATCH", {}), params)).status).toBe(400);
  });

  test("retires and restores through is_active", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    const { configChain } = setup({ row: SUBREASON });

    await PATCH(req("PATCH", { is_active: false }), params);
    expect(configChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false }),
    );
  });
});

describe("DELETE /api/settings/rejection-reasons/[id]", () => {
  test("403 for an agent", async () => {
    vi.mocked(getActor).mockResolvedValue(tnAgent);
    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
  });

  // Groups mirror the Postgres enum. There is no version of this that works.
  test("409 on a group, whether or not it is used", async () => {
    vi.mocked(getActor).mockResolvedValue(superAdmin);
    setup({ row: GROUP, usage: 0 });

    const res = await DELETE(req("DELETE"), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/group/i);
  });

  test("hard-deletes a sub-reason no order has ever used", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    const { configChain } = setup({ row: SUBREASON, usage: 0 });

    const res = await DELETE(req("DELETE"), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mode).toBe("deleted");
    expect(body.usage).toBe(0);
    expect(configChain.delete).toHaveBeenCalled();
    expect(configChain.update).not.toHaveBeenCalled();
  });

  // The decision: history stays readable. 213 orders keep rendering "Raccroche"
  // long after the reason left the picker.
  test("retires a sub-reason that orders already carry, instead of deleting it", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    const { configChain } = setup({ row: SUBREASON, usage: 213 });

    const res = await DELETE(req("DELETE"), params);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.mode).toBe("retired");
    expect(body.usage).toBe(213);
    expect(configChain.update).toHaveBeenCalledWith(
      expect.objectContaining({ is_active: false }),
    );
    expect(configChain.delete).not.toHaveBeenCalled();
  });

  test("404 for an unknown id", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: null });

    expect((await DELETE(req("DELETE"), params)).status).toBe(404);
  });

  test("403 when a manager deletes from another market", async () => {
    vi.mocked(getActor).mockResolvedValue(tnManager);
    setup({ row: { ...SUBREASON, market_id: LY } });

    expect((await DELETE(req("DELETE"), params)).status).toBe(403);
  });
});
