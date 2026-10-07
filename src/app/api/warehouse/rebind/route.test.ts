import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockFrom = vi.fn();
const mockRpc = vi.fn();
const mockAdminFrom = vi.fn();
const mockResolveDarbShipment = vi.fn();
const mockBindDarbReference = vi.fn();
const mockVerifyDarbReference = vi.fn();

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...args: unknown[]) => mockGetActor(...args),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
  }),
  createAdminClient: vi.fn(() => ({
    from: (...args: unknown[]) => mockAdminFrom(...args),
  })),
}));
vi.mock("@/lib/carriers/darb-assabil-reference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/carriers/darb-assabil-reference")>()),
  resolveDarbShipment: (...args: unknown[]) => mockResolveDarbShipment(...args),
  bindDarbReference: (...args: unknown[]) => mockBindDarbReference(...args),
  verifyDarbReference: (...args: unknown[]) => mockVerifyDarbReference(...args),
}));
vi.mock("@/lib/carriers/dispatch", () => ({
  buildConfig: vi.fn(() => ({ id: "darb-1", code: "darb_assabil" })),
}));

import { POST } from "./route";
import { NextRequest } from "next/server";

const TRIPOLI = "wh-tripoli";
const BENGHAZI = "wh-benghazi";

function req(body: unknown = { order_id: "order-1", sticker_ref: "1213123" }) {
  return new NextRequest(new URL("http://localhost/api/warehouse/rebind"), {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function chain(result: unknown) {
  const c: Record<string, unknown> = {};
  c.select = vi.fn().mockReturnValue(c);
  c.eq = vi.fn().mockReturnValue(c);
  c.maybeSingle = vi.fn().mockResolvedValue({ data: result, error: null });
  c.single = vi.fn().mockResolvedValue({ data: result, error: null });
  return c;
}

/** A scanned Libyan Darb parcel standing in Tripoli. */
function darbOrder(over: Record<string, unknown> = {}) {
  return {
    id: "order-1",
    status: "scanned",
    market_id: "ly",
    warehouse_id: TRIPOLI,
    carrier_id: "darb-1",
    carrier_extra: { darb_assabil_id: "darb-internal-1" },
    tracking_number: "SH1",
    carrier_sticker_ref: "1213123",
    carriers: { code: "darb_assabil" },
    ...over,
  };
}

function wire({
  actor = { id: "wa-1", role: "warehouse_agent", market_id: "ly" } as Record<string, unknown>,
  ownSite = TRIPOLI as string | null,
  order = darbOrder() as Record<string, unknown> | null,
} = {}) {
  mockGetActor.mockResolvedValue({ actor });
  mockFrom.mockImplementation((table: string) =>
    table === "users" ? chain({ warehouse_id: ownSite }) : chain(order),
  );
  mockAdminFrom.mockImplementation(() => chain({ id: "darb-1", code: "darb_assabil" }));
}

/** Nothing reached Darb, and nothing was written. */
function expectNoCarrierWrite() {
  expect(mockAdminFrom).not.toHaveBeenCalled();
  expect(mockBindDarbReference).not.toHaveBeenCalled();
  expect(mockVerifyDarbReference).not.toHaveBeenCalled();
  expect(mockRpc).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRpc.mockResolvedValue({ data: null, error: null });
  mockBindDarbReference.mockResolvedValue({ ok: true, message: null });
  mockVerifyDarbReference.mockResolvedValue({
    verified: true,
    actualReference: "1213123",
    rawStatus: "pending",
  });
});

describe("POST /api/warehouse/rebind — the building guards the carrier write", () => {
  // The rebind writes to Darb with admin-decrypted credentials. It had no site,
  // unassigned or status check, so any warehouse agent could re-sticker any
  // parcel of the market — including the other building's.
  test("an agent with no building is refused before anything else", async () => {
    wire({ ownSite: null });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe("NO_SITE_ASSIGNED");
    expectNoCarrierWrite();
  });

  test("an agent cannot rebind the other building's parcel", async () => {
    wire({ order: darbOrder({ warehouse_id: BENGHAZI }) });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe("WRONG_SITE");
    expectNoCarrierWrite();
  });

  test("a parcel with no building is not the agent's either", async () => {
    wire({ order: darbOrder({ warehouse_id: null }) });
    const res = await POST(req());
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe("WRONG_SITE");
    expectNoCarrierWrite();
  });

  test("another market's parcel is refused (manager too)", async () => {
    wire({
      actor: { id: "mgr-1", role: "market_manager", market_id: "tn" },
      order: darbOrder(),
    });
    const res = await POST(req());
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("MARKET_MISMATCH");
    expectNoCarrierWrite();
  });

  test.each(["uploaded", "confirmed", "delivered", "returned", "cancelled"])(
    "a parcel in %s is refused — the rebind is for parcels already scanned out",
    async (status) => {
      wire({ order: darbOrder({ status }) });
      const res = await POST(req());
      expect(res.status).toBe(409);
      expect((await res.json()).error_code).toBe("INVALID_STATUS");
      expectNoCarrierWrite();
    },
  );

  test.each(["scanned", "at_carrier"])(
    "the agent of the parcel's building rebinds a %s parcel",
    async (status) => {
      wire({ order: darbOrder({ status }) });
      const res = await POST(req());
      expect(res.status).toBe(200);
      expect(mockBindDarbReference).toHaveBeenCalledWith(
        "darb-internal-1",
        "1213123",
        expect.anything(),
      );
      expect((await res.json()).sticker_bind_state).toBe("confirmed");
    },
  );

  test("a manager of the market rebinds a parcel of either building", async () => {
    wire({
      actor: { id: "mgr-1", role: "market_manager", market_id: "ly" },
      order: darbOrder({ warehouse_id: BENGHAZI }),
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(mockBindDarbReference).toHaveBeenCalledTimes(1);
  });

  test("the owner rebinds in any market", async () => {
    wire({
      actor: { id: "sa-1", role: "super_admin", market_id: null },
      order: darbOrder({ warehouse_id: BENGHAZI }),
    });
    const res = await POST(req());
    expect(res.status).toBe(200);
  });
});
