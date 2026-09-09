import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAdminFrom = vi.fn();
const mockResolveDarbShipment = vi.fn();
const mockBindDarbReference = vi.fn();
const mockVerifyDarbReference = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: () => mockGetUser() },
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  })),
}));

// Partial mock: the three network calls are stubbed, but `classifyBindState` is
// pure and is the thing under test on the unverified path — mocking it would
// assert against our own stub instead of the real classification.
vi.mock("@/lib/carriers/darb-assabil-reference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/carriers/darb-assabil-reference")>()),
  resolveDarbShipment: (...args: unknown[]) => mockResolveDarbShipment(...args),
  bindDarbReference: (...args: unknown[]) => mockBindDarbReference(...args),
  verifyDarbReference: (...args: unknown[]) => mockVerifyDarbReference(...args),
}));

vi.mock("@/lib/carriers/dispatch", () => ({
  buildConfig: vi.fn(() => ({
    id: "darb-1",
    code: "darb_assabil",
    apiEndpoint: "https://v2.sabil.ly",
    apiCredentials: { api_key: "k", account_id: "a" },
    deliveryFee: 0,
    returnFee: 0,
  })),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

function req(body: unknown = { order_id: "order-1" }) {
  return new NextRequest(new URL("http://localhost/api/warehouse/scan-out"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * The route touches three tables and two RPCs, so the mock dispatches on table
 * name rather than returning one shape for everything. `orderRow` null means
 * "no row" — the historical default, which keeps the pre-existing cases
 * meaning exactly what they meant before the Darb call was added.
 */
function wireSupabase({
  actor = { role: "warehouse_agent", market_id: "m-1" } as Record<string, unknown> | null,
  actorError = null as unknown,
  orderRow = null as Record<string, unknown> | null,
  carrierRow = null as Record<string, unknown> | null,
} = {}) {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  const update = vi.fn().mockReturnValue({ eq: updateEq });

  mockFrom.mockImplementation((table: string) => {
    if (table === "users") {
      const c: Record<string, unknown> = {};
      c.select = vi.fn().mockReturnValue(c);
      c.eq = vi.fn().mockReturnValue(c);
      c.single = vi.fn().mockResolvedValue({ data: actor, error: actorError });
      c.maybeSingle = vi.fn().mockResolvedValue({ data: actor, error: actorError });
      return c;
    }
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.maybeSingle = vi.fn().mockResolvedValue({ data: orderRow, error: null });
    c.single = vi.fn().mockResolvedValue({ data: orderRow, error: null });
    c.update = update;
    return c;
  });

  mockAdminFrom.mockImplementation(() => {
    const c: Record<string, unknown> = {};
    c.select = vi.fn().mockReturnValue(c);
    c.eq = vi.fn().mockReturnValue(c);
    c.maybeSingle = vi.fn().mockResolvedValue({ data: carrierRow, error: null });
    c.single = vi.fn().mockResolvedValue({ data: carrierRow, error: null });
    return c;
  });

  return { update, updateEq };
}

/** An order the bench would actually scan: Libyan, Darb, already uploaded. */
function darbOrder(overrides: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    carrier_id: "darb-1",
    tracking_number: "SH2057999",
    customer_city: "بنغازي",
    carrier_extra: { city: "بنغازي" },
    carriers: { code: "darb_assabil", supplies_own_labels: true },
    ...overrides,
  };
}

const okPrecheck = { ok: true, required_color: "#339307", branch_group: "BN" };

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockImplementation((fn: string) =>
    fn === "precheck_scan_out"
      ? Promise.resolve({ data: okPrecheck, error: null })
      : Promise.resolve({ data: { success: true }, error: null }),
  );
  mockResolveDarbShipment.mockResolvedValue({
    internalId: "darb-internal-1",
    reference: "SH2057999",
    branchGroup: "BN",
    rawStatus: "pending",
  });
  mockBindDarbReference.mockResolvedValue({ ok: true, message: null });
  mockVerifyDarbReference.mockResolvedValue({ verified: true, actualReference: "889201", rawStatus: "pending" });
});

describe("POST /api/warehouse/scan-out — auth", () => {
  test("returns 401 when not authenticated", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    wireSupabase();
    const res = await POST(req());
    expect(res.status).toBe(401);
  });

  test("returns 403 for agent role", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    wireSupabase({ actor: { role: "agent", market_id: "m-1" } });
    const res = await POST(req());
    expect(res.status).toBe(403);
  });
});

describe("POST /api/warehouse/scan-out — validation", () => {
  test("returns 400 when order_id is missing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    wireSupabase();
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/order_id/i);
  });

  test("returns 400 for malformed JSON", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "u-1" } } });
    wireSupabase();
    const badReq = new NextRequest(new URL("http://localhost/api/warehouse/scan-out"), {
      method: "POST",
      body: "not-json",
    });
    expect((await POST(badReq)).status).toBe(400);
  });
});

describe("POST /api/warehouse/scan-out — success", () => {
  test("calls scan_order_out RPC and returns result for warehouse_agent", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase();
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: okPrecheck, error: null })
        : Promise.resolve({
            data: { success: true, new_status: "scanned", stock_after: 9 },
            error: null,
          }),
    );
    const res = await POST(req({ order_id: "order-1" }));
    expect(res.status).toBe(200);
    expect((await res.json()).new_status).toBe("scanned");
    expect(mockRpc).toHaveBeenCalledWith("scan_order_out", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
      p_sticker_ref: null,
    });
  });

  test("allows market_manager to scan out", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "mm-1" } } });
    wireSupabase({ actor: { role: "market_manager", market_id: "m-1" } });
    const res = await POST(req({ order_id: "order-2" }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/warehouse/scan-out — structured RPC errors", () => {
  test.each([
    ["Order has no printed label — print label before scanning", "NO_LABEL_PRINTED"],
    ["Order belongs to a different market", "MARKET_MISMATCH"],
    ["Order is not in confirmed status (current: scanned)", "INVALID_STATUS"],
    ["stock cannot go below zero", "STOCK_UNDERFLOW"],
    ["Order not found: abc-123", "ORDER_NOT_FOUND"],
    ["Sticker 889201 is already bound to another order", "STICKER_ALREADY_USED"],
  ])("%s → %s", async (message, code) => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase();
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: okPrecheck, error: null })
        : Promise.resolve({ data: null, error: { message } }),
    );
    const res = await POST(req({ order_id: "order-1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe(code);
  });
});

// Orders the carrier fulfils from its own warehouse must never be scanned out:
// those units already left our stock at handover, so scan_order_out would
// deduct current_stock a second time for goods we no longer hold.
describe("POST /api/warehouse/scan-out — carrier-warehouse orders", () => {
  test("refuses the scan and never calls the RPC", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({ orderRow: { carrier_extra: { fulfil_from_carrier_warehouse: true } } });

    const res = await POST(req({ order_id: "order-1" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("CARRIER_WAREHOUSE_ORDER");
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockBindDarbReference).not.toHaveBeenCalled();
  });

  test("still scans a normal order whose carrier_extra lacks the flag", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({ orderRow: { carrier_extra: { city: "طرابلس" } } });

    const res = await POST(req({ order_id: "order-1" }));

    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith("scan_order_out", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
      p_sticker_ref: null,
    });
  });
});

/**
 * The Darb binding. Ordering is the point of these tests: the carrier write has
 * to succeed BEFORE anything is committed on our side, because a committed scan
 * whose parcel Darb cannot route ships a dead parcel, whereas a binding with no
 * local commit is harmless — re-scanning the same sticker rebinds identically.
 */
describe("POST /api/warehouse/scan-out — binding the sticker at Darb", () => {
  const scan = { order_id: "order-1", sticker_ref: "889201" };

  test("binds at Darb before committing the scan locally", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({ orderRow: darbOrder(), carrierRow: { id: "darb-1", code: "darb_assabil" } });

    const order: string[] = [];
    mockBindDarbReference.mockImplementation(async () => {
      order.push("darb");
      return { ok: true, message: null };
    });
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "scan_order_out") order.push("commit");
      return Promise.resolve({
        data: fn === "precheck_scan_out" ? okPrecheck : { success: true },
        error: null,
      });
    });

    const res = await POST(req(scan));

    expect(res.status).toBe(200);
    expect(order).toEqual(["darb", "commit"]);
    expect(mockBindDarbReference).toHaveBeenCalledWith("darb-internal-1", "889201", expect.anything());
    expect(mockRpc).toHaveBeenCalledWith("scan_order_out", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
      p_sticker_ref: "889201",
    });
  });

  test("commits nothing when Darb refuses the binding", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({ orderRow: darbOrder(), carrierRow: { id: "darb-1", code: "darb_assabil" } });
    mockBindDarbReference.mockResolvedValue({ ok: false, message: "shipment completed" });

    const res = await POST(req(scan));

    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error_code).toBe("DARB_BIND_FAILED");
    // Darb's own words reach the bench.
    expect(json.message).toContain("shipment completed");
    expect(mockRpc).not.toHaveBeenCalledWith("scan_order_out", expect.anything());
  });

  test("uses the cached Darb id and skips the lookup", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({
      orderRow: darbOrder({
        carrier_extra: { darb_assabil_id: "cached-id", darb_branch_group: "BN" },
      }),
      carrierRow: { id: "darb-1", code: "darb_assabil" },
    });

    const res = await POST(req(scan));

    expect(res.status).toBe(200);
    expect(mockResolveDarbShipment).not.toHaveBeenCalled();
    expect(mockBindDarbReference).toHaveBeenCalledWith("cached-id", "889201", expect.anything());
  });

  test("resolves the id by reference and writes it back, so it is looked up once", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    const { update } = wireSupabase({
      orderRow: darbOrder(),
      carrierRow: { id: "darb-1", code: "darb_assabil" },
    });

    await POST(req(scan));

    expect(mockResolveDarbShipment).toHaveBeenCalledWith("SH2057999", expect.anything());
    // Through a SECURITY DEFINER RPC, never the session client: the orders
    // UPDATE policy has no warehouse_agent arm, so a session update silently
    // touched zero rows for the floor role and every scan re-did the lookup.
    expect(mockRpc).toHaveBeenCalledWith("cache_darb_shipment_ref", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
      p_darb_id: "darb-internal-1",
      p_branch_group: "BN",
    });
    expect(update).not.toHaveBeenCalled();
  });

  test("refuses a parcel the carrier already released, before any carrier write", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({
      orderRow: darbOrder({ carrier_extra: { darb_assabil_id: "cached-id", darb_branch_group: "BN" } }),
      carrierRow: { id: "darb-1", code: "darb_assabil" },
    });
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: { ok: false, code: "GONE_AT_CARRIER", carrier_status: "released" }, error: null })
        : Promise.resolve({ data: { success: true }, error: null }),
    );

    const res = await POST(req(scan));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error_code).toBe("GONE_AT_CARRIER");
    expect(json.carrier_status).toBe("released");
    expect(mockBindDarbReference).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith("scan_order_out", expect.anything());
  });

  test("refuses a sticker that is not a plain number, before any carrier write", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({
      orderRow: darbOrder({ carrier_extra: { darb_assabil_id: "cached-id", darb_branch_group: "BN" } }),
      carrierRow: { id: "darb-1", code: "darb_assabil" },
    });
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: { ok: false, code: "STICKER_NOT_NUMERIC", sticker: "https://x/1" }, error: null })
        : Promise.resolve({ data: { success: true }, error: null }),
    );

    const res = await POST(req({ order_id: "order-1", sticker_ref: "https://x/1" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("STICKER_NOT_NUMERIC");
    expect(mockBindDarbReference).not.toHaveBeenCalled();
  });

  test("a role refusal from the RPC is a 403, not a missing order", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({ orderRow: darbOrder({ carrier_extra: { darb_assabil_id: "cached-id" } }), carrierRow: { id: "darb-1", code: "darb_assabil" } });
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: okPrecheck, error: null })
        : Promise.resolve({ data: null, error: { message: "Actor role agent cannot scan out" } }),
    );

    const res = await POST(req(scan));

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe("FORBIDDEN");
  });

  test("refuses when Darb has no shipment for the reference", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({ orderRow: darbOrder(), carrierRow: { id: "darb-1", code: "darb_assabil" } });
    mockResolveDarbShipment.mockResolvedValue(null);

    const res = await POST(req(scan));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("DARB_SHIPMENT_UNKNOWN");
    expect(mockBindDarbReference).not.toHaveBeenCalled();
    expect(mockRpc).not.toHaveBeenCalledWith("scan_order_out", expect.anything());
  });

  test("refuses a duplicate sticker before touching the carrier at all", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({ orderRow: darbOrder(), carrierRow: { id: "darb-1", code: "darb_assabil" } });
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({
            data: { ok: false, code: "STICKER_ALREADY_USED", sticker: "889201" },
            error: null,
          })
        : Promise.resolve({ data: { success: true }, error: null }),
    );

    const res = await POST(req(scan));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("STICKER_ALREADY_USED");
    // A doomed scan must never cause a carrier write.
    expect(mockBindDarbReference).not.toHaveBeenCalled();
  });

  test("Tunisia is untouched: no sticker, no lookup, no carrier call", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({
      orderRow: darbOrder({
        carriers: { code: "navex", supplies_own_labels: false },
        customer_city: "Tunis",
      }),
      carrierRow: { id: "navex-1", code: "navex" },
    });

    const res = await POST(req({ order_id: "order-1" }));

    expect(res.status).toBe(200);
    expect(mockResolveDarbShipment).not.toHaveBeenCalled();
    expect(mockBindDarbReference).not.toHaveBeenCalled();
  });

  test("a bound sticker whose local commit fails says so explicitly", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({ orderRow: darbOrder(), carrierRow: { id: "darb-1", code: "darb_assabil" } });
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: okPrecheck, error: null })
        : Promise.resolve({ data: null, error: { message: "stock cannot go below zero" } }),
    );

    const res = await POST(req(scan));

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error_code).toBe("STOCK_UNDERFLOW");
    // The operator must know the parcel IS bound at Darb, or they will assume
    // nothing happened and re-sticker it.
    expect(json.darb_bound).toBe(true);
  });
});

/**
 * Verifying the bind before committing.
 *
 * Darb answering `status: true` to the PATCH is not proof the number stuck:
 * sticker 1633019 was accepted on 2026-09-08 and Darb kept `SH2171145`. The
 * parcel then shipped with a number the carrier could not route, and the stock
 * was already deducted. So the commit now waits for a re-read.
 */
describe("POST /api/warehouse/scan-out — verifying the bind at Darb", () => {
  const scan = { order_id: "order-1", sticker_ref: "889201" };

  function wireDarb() {
    wireSupabase({
      orderRow: darbOrder({ carrier_extra: { darb_assabil_id: "cached-id", darb_branch_group: "BN" } }),
      carrierRow: { id: "darb-1", code: "darb_assabil" },
    });
  }

  test("retries once, then lets the parcel out and flags it", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireDarb();
    // Darb never keeps it, even on the retry.
    mockVerifyDarbReference.mockResolvedValue({
      verified: false,
      actualReference: "SH2171145",
      rawStatus: "pending",
    });

    const res = await POST(req(scan));

    // The parcel is stickered and physically leaving; Darb's reception recovers
    // the number at booking. Blocking would strand it — so it commits, loudly.
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.sticker_bind_state).toBe("not_registered");
    expect(json.carrier_reference).toBe("SH2171145");
    expect(mockBindDarbReference).toHaveBeenCalledTimes(2);
    expect(mockRpc).toHaveBeenCalledWith("scan_order_out", expect.anything());
  });

  test("a retry that works is not reported as a problem", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireDarb();
    mockVerifyDarbReference
      .mockResolvedValueOnce({ verified: false, actualReference: "SH2171145", rawStatus: "pending" })
      .mockResolvedValueOnce({ verified: true, actualReference: "889201", rawStatus: "pending" });

    const res = await POST(req(scan));

    expect(res.status).toBe(200);
    expect((await res.json()).sticker_bind_state).toBe("confirmed");
    expect(mockBindDarbReference).toHaveBeenCalledTimes(2);
  });

  test("a bind Darb kept is not retried", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireDarb();

    await POST(req(scan));

    expect(mockBindDarbReference).toHaveBeenCalledTimes(1);
  });

  test("verifies before committing, and only then commits", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireDarb();

    const order: string[] = [];
    mockBindDarbReference.mockImplementation(async () => {
      order.push("bind");
      return { ok: true, message: null };
    });
    mockVerifyDarbReference.mockImplementation(async () => {
      order.push("verify");
      return { verified: true, actualReference: "889201", rawStatus: "pending" };
    });
    mockRpc.mockImplementation((fn: string) => {
      if (fn === "scan_order_out") order.push("commit");
      return Promise.resolve({
        data: fn === "precheck_scan_out" ? okPrecheck : { success: true },
        error: null,
      });
    });

    const res = await POST(req(scan));

    expect(res.status).toBe(200);
    expect(order).toEqual(["bind", "verify", "commit"]);
  });

  test("records the confirmed bind state so the scanned list can show it", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireDarb();

    await POST(req(scan));

    expect(mockRpc).toHaveBeenCalledWith("record_sticker_bind_state", {
      p_order_id: "order-1",
      p_actor_id: "wh-1",
      p_state: "confirmed",
      p_darb_reference: "889201",
    });
  });

  test("Tunisia commits without any verification — there is no sticker to verify", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase({
      orderRow: darbOrder({ carriers: { code: "navex", supplies_own_labels: false } }),
      carrierRow: { id: "navex-1", code: "navex" },
    });

    const res = await POST(req({ order_id: "order-1" }));

    expect(res.status).toBe(200);
    expect(mockVerifyDarbReference).not.toHaveBeenCalled();
  });
});

/**
 * The RPC now names its own refusals (20260922000002). Prose matching was the
 * bridge; the code in `details` is the contract, and it must win when both are
 * present — a French message can be reworded, a code cannot drift silently.
 */
describe("POST /api/warehouse/scan-out — the RPC's own error code wins", () => {
  test("reads DETAIL.code rather than the message", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase();
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: okPrecheck, error: null })
        : Promise.resolve({
            data: null,
            // Message says nothing recognisable; the code says everything.
            error: { message: "quelque chose a mal tourné", details: '{"code":"STOCK_UNDERFLOW"}' },
          }),
    );

    const res = await POST(req({ order_id: "order-1" }));

    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("STOCK_UNDERFLOW");
  });

  test("an actor mismatch surfaces as a refusal the agent can read", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "wh-1" } } });
    wireSupabase();
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: okPrecheck, error: null })
        : Promise.resolve({
            data: null,
            error: { message: "Un scan ne peut pas...", details: '{"code":"ACTOR_MISMATCH"}' },
          }),
    );

    const res = await POST(req({ order_id: "order-1" }));

    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe("FORBIDDEN");
  });
});

/**
 * The wrong building.
 *
 * Libya's two Darb Assabil accounts are two physical warehouses. A parcel booked
 * on the Benghazi account and handed to Darb Tripoli does not exist in their
 * system: it cannot be tracked, paid or returned. `precheck_scan_out` has
 * refused this since 20260922000013 AND computed the name of the building the
 * parcel belongs to — but the route dropped the name and the code was missing
 * from its status table, so the bench showed a generic error. The agent could
 * not learn which shelf the parcel was actually from.
 */
describe("POST /api/warehouse/scan-out — the building", () => {
  function refuse(precheck: Record<string, unknown>) {
    mockRpc.mockImplementation((fn: string) =>
      fn === "precheck_scan_out"
        ? Promise.resolve({ data: precheck, error: null })
        : Promise.resolve({ data: { success: true }, error: null }),
    );
  }

  test("names the building the parcel belongs to", async () => {
    wireSupabase({ orderRow: darbOrder() });
    refuse({ ok: false, code: "WRONG_SITE", warehouse_id: "site-tripoli", warehouse_name: "Tripoli" });
    const res = await POST(req());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error_code).toBe("WRONG_SITE");
    // Without the name the message can only be "wrong building" — useless to
    // someone holding the parcel and wondering where it should go.
    expect(body.warehouse_name).toBe("Tripoli");
  });

  test("never commits the scan for a parcel of the other building", async () => {
    wireSupabase({ orderRow: darbOrder() });
    refuse({ ok: false, code: "WRONG_SITE", warehouse_name: "Tripoli" });
    await POST(req());
    expect(mockRpc).not.toHaveBeenCalledWith("scan_order_out", expect.anything());
  });

  test("an agent with no building at all is refused with its own code", async () => {
    wireSupabase({ orderRow: darbOrder() });
    refuse({ ok: false, code: "NO_SITE_ASSIGNED" });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("NO_SITE_ASSIGNED");
  });
});
