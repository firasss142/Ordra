import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Undo a pickup list (owner, 2026-10-08). The gates live here; what X-Delivery is
 * told and which orders go back to `uploaded` is pickup.ts (its own tests).
 */

const mockGetActor = vi.fn();
let manifestRow: Record<string, unknown> | null = null;

function chain() {
  const c: Record<string, unknown> = {};
  for (const op of ["select", "eq"]) c[op] = () => c;
  c.maybeSingle = () => Promise.resolve({ data: manifestRow, error: null });
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: () => chain() })),
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));
const siteFilter = vi.fn();
vi.mock("@/lib/warehouse/site-scope", () => ({ resolveSiteFilter: (...a: unknown[]) => siteFilter(...a) }));
vi.mock("@/lib/journal/route-errors", () => ({ withRouteErrors: (_p: string, _m: string, h: unknown) => h }));
const accounts = vi.fn();
vi.mock("@/lib/carriers/xdelivery/production", () => ({
  loadXDeliveryPortalAccounts: (...a: unknown[]) => accounts(...a),
  buildReleaseDeps: () => ({}),
}));
vi.mock("@/lib/carriers/xdelivery/portal", () => ({ XDeliveryPortal: vi.fn() }));
const release = vi.fn();
vi.mock("@/lib/carriers/xdelivery/pickup", async (orig) => ({
  ...(await orig<typeof import("@/lib/carriers/xdelivery/pickup")>()),
  releaseFromPickup: (...a: unknown[]) => release(...a),
}));

import { DELETE, PATCH } from "./route";

const url = "http://localhost/api/warehouse/xdelivery-pickup/row-1";
const ctx = { params: { manifestId: "row-1" } };
const del = () => DELETE(new NextRequest(new URL(url), { method: "DELETE" }), ctx);
const patch = (body: unknown) => PATCH(new NextRequest(new URL(url), { method: "PATCH", body: JSON.stringify(body) }), ctx);

beforeEach(() => {
  vi.clearAllMocks();
  manifestRow = { id: "row-1", carrier_id: "xd-1", market_id: "m-tn", warehouse_id: "w-tunis", kind: "pickup" };
  mockGetActor.mockResolvedValue({ actor: { id: "u-1", role: "warehouse_agent", market_id: "m-tn" } });
  siteFilter.mockResolvedValue({ warehouseId: "w-tunis", pinned: true, unassigned: false });
  accounts.mockResolvedValue([{ carrierId: "xd-1", marketId: "m-tn", warehouseId: "w-tunis", login: { email: "e", password: "p" } }]);
  release.mockResolvedValue({ released: [{ orderId: "o1", barcode: "611" }], skipped: [], manifestDeleted: true });
});

describe("DELETE — the whole list", () => {
  test("releases every parcel of the list, signed by the caller", async () => {
    const res = await del();
    expect(res.status).toBe(200);
    expect(release).toHaveBeenCalledWith({}, { manifestId: "row-1", orderIds: "all", actorId: "u-1" });
    expect((await res.json()).manifestDeleted).toBe(true);
  });

  test("a list the caller cannot see, or of another market, is a 404", async () => {
    manifestRow = null;
    expect((await del()).status).toBe(404);
    manifestRow = { id: "row-1", carrier_id: "xd-1", market_id: "m-ly", warehouse_id: "w-tunis", kind: "pickup" };
    expect((await del()).status).toBe(404);
    expect(release).not.toHaveBeenCalled();
  });

  test("an agent of another building may not undo it", async () => {
    siteFilter.mockResolvedValue({ warehouseId: "w-sfax", pinned: true, unassigned: false });
    expect((await del()).status).toBe(403);
  });

  test("without the portal login, nothing can be undone at X-Delivery", async () => {
    accounts.mockResolvedValue([{ carrierId: "xd-1", marketId: "m-tn", warehouseId: "w-tunis", login: null }]);
    expect((await (await del()).json()).error_code).toBe("NO_PORTAL_LOGIN");
  });
});

describe("PATCH — some parcels", () => {
  test("only the given orders leave the list", async () => {
    await patch({ order_ids: ["o1", "o2", "o1"] });
    expect(release).toHaveBeenCalledWith({}, { manifestId: "row-1", orderIds: ["o1", "o2"], actorId: "u-1" });
  });

  test("no order ids is a 400, never a silent whole-list delete", async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ order_ids: [] })).status).toBe(400);
    expect(release).not.toHaveBeenCalled();
  });
});
