import { describe, test, expect, vi, beforeEach } from "vitest";

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { GET, PUT } from "./route";
import { NextRequest } from "next/server";
import { setTestActor, resetTestActor } from "@/test/helpers/actorMock";

const CARRIER_ID = "11111111-1111-1111-1111-111111111111";
const MARKET_LY = "22222222-2222-2222-2222-222222222222";
const MARKET_TN = "33333333-3333-3333-3333-333333333333";

function getReq() {
  return new NextRequest(
    new URL(`/api/carriers/${CARRIER_ID}/order-preferences`, "http://localhost:3000"),
    { method: "GET" },
  );
}

function putReq(body: unknown) {
  return new NextRequest(
    new URL(`/api/carriers/${CARRIER_ID}/order-preferences`, "http://localhost:3000"),
    { method: "PUT", body: JSON.stringify(body) },
  );
}

const params = Promise.resolve({ id: CARRIER_ID });

/** The `carriers` lookup used to verify the carrier exists and its market. */
function carrierChain(row: { id: string; market_id: string } | null) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.single = vi.fn().mockResolvedValue({ data: row, error: row ? null : { message: "no rows" } });
  return c;
}

function prefsSelectChain(rows: unknown[]) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockResolvedValue({ data: rows, error: null });
  return c;
}

function prefsUpsertChain(capture: { rows?: unknown }) {
  const c: Record<string, unknown> = {};
  c.upsert = vi.fn((rows: unknown) => {
    capture.rows = rows;
    return Promise.resolve({ data: null, error: null });
  });
  return c;
}

beforeEach(() => {
  resetTestActor();
  mockFrom.mockReset();
});

describe("GET /api/carriers/[id]/order-preferences", () => {
  test("returns the six resolved options, coded defaults when nothing is stored", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_LY })
        : prefsSelectChain([]),
    );

    const res = await GET(getReq(), { params });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Object.keys(body.data)).toHaveLength(6);
    // Pickup is the one coded ON.
    expect(body.data.is_pickup).toEqual({ value: true, canOverride: true });
    expect(body.data.allow_testing).toEqual({ value: false, canOverride: true });
  });

  test("a stored row wins over the coded default", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_LY })
        : prefsSelectChain([
            {
              carrier_id: CARRIER_ID,
              option_key: "allow_inspection",
              default_value: true,
              can_override: false,
            },
          ]),
    );

    const res = await GET(getReq(), { params });
    const body = await res.json();
    expect(body.data.allow_inspection).toEqual({ value: true, canOverride: false });
  });

  test("returns both fulfilment modes, on by default", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_LY })
        : prefsSelectChain([]),
    );

    const res = await GET(getReq(), { params });
    const body = await res.json();
    expect(body.fulfilmentModes).toEqual({ home: true, carrier: true });
  });

  test("reflects a fulfilment mode that has been turned off", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_LY })
        : prefsSelectChain([
            {
              carrier_id: CARRIER_ID,
              option_key: "mode_carrier_warehouse",
              default_value: false,
              can_override: true,
            },
          ]),
    );

    const res = await GET(getReq(), { params });
    const body = await res.json();
    expect(body.fulfilmentModes).toEqual({ home: true, carrier: false });
    // The six order options are unaffected by a mode row.
    expect(Object.keys(body.data)).toHaveLength(6);
  });

  test("404 when the carrier does not exist", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    mockFrom.mockImplementation(() => carrierChain(null));

    const res = await GET(getReq(), { params });
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/carriers/[id]/order-preferences", () => {
  test("super_admin writes the six options", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    const capture: { rows?: unknown } = {};
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_LY })
        : prefsUpsertChain(capture),
    );

    const res = await PUT(
      putReq({
        preferences: {
          allow_inspection: { value: true, canOverride: false },
          is_pickup: { value: true, canOverride: true },
        },
      }),
      { params },
    );

    expect(res.status).toBe(200);
    const rows = capture.rows as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual({
      carrier_id: CARRIER_ID,
      option_key: "allow_inspection",
      default_value: true,
      can_override: false,
    });
  });

  test("a market_manager is refused even in their own market", async () => {
    setTestActor({ role: "market_manager", market_id: MARKET_LY });
    mockFrom.mockImplementation(() => carrierChain({ id: CARRIER_ID, market_id: MARKET_LY }));

    const res = await PUT(
      putReq({ preferences: { is_fragile: { value: true, canOverride: true } } }),
      { params },
    );
    expect(res.status).toBe(403);
  });

  test("an agent is refused", async () => {
    setTestActor({ role: "agent", market_id: MARKET_LY });
    mockFrom.mockImplementation(() => carrierChain({ id: CARRIER_ID, market_id: MARKET_LY }));

    const res = await PUT(
      putReq({ preferences: { is_fragile: { value: true, canOverride: true } } }),
      { params },
    );
    expect(res.status).toBe(403);
  });

  test("rejects an unknown option key rather than writing it", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_TN });
    const capture: { rows?: unknown } = {};
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_TN })
        : prefsUpsertChain(capture),
    );

    const res = await PUT(
      putReq({ preferences: { drop_table_orders: { value: true, canOverride: true } } }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(capture.rows).toBeUndefined();
  });

  test("writes the two fulfilment modes", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    const capture: { rows?: unknown } = {};
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_LY })
        : prefsUpsertChain(capture),
    );

    const res = await PUT(
      putReq({
        preferences: {},
        fulfilmentModes: { home: true, carrier: false },
      }),
      { params },
    );

    expect(res.status).toBe(200);
    const rows = capture.rows as Array<Record<string, unknown>>;
    expect(rows).toContainEqual({
      carrier_id: CARRIER_ID,
      option_key: "mode_carrier_warehouse",
      default_value: false,
      can_override: true,
    });
  });

  // Turning both off would leave the carrier with nowhere to ship from.
  test("refuses to turn both fulfilment modes off", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    const capture: { rows?: unknown } = {};
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_LY })
        : prefsUpsertChain(capture),
    );

    const res = await PUT(
      putReq({
        preferences: {},
        fulfilmentModes: { home: false, carrier: false },
      }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(capture.rows).toBeUndefined();
  });

  test("rejects a non-boolean value rather than coercing it", async () => {
    setTestActor({ role: "super_admin", market_id: MARKET_LY });
    const capture: { rows?: unknown } = {};
    mockFrom.mockImplementation((table: string) =>
      table === "carriers"
        ? carrierChain({ id: CARRIER_ID, market_id: MARKET_LY })
        : prefsUpsertChain(capture),
    );

    const res = await PUT(
      putReq({ preferences: { is_fragile: { value: "yes", canOverride: true } } }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(capture.rows).toBeUndefined();
  });
});
