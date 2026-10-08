import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * « Demande d'enlèvement » on demand (owner, 2026-10-08; docs/xdelivery-manifests.md).
 * The route decides WHO and WHICH ACCOUNT; pickup.ts decides what X-Delivery is
 * asked (its own tests). Here: the gates, and that the batch reaches the right account.
 */

const mockGetActor = vi.fn();
const tables: Record<string, Record<string, unknown>[]> = {};

function chain(table: string) {
  const c: Record<string, unknown> = {};
  for (const op of ["select", "eq", "in", "is", "gte", "order", "limit"]) c[op] = () => c;
  c.maybeSingle = () => Promise.resolve({ data: (tables[table] ?? [])[0] ?? null, error: null });
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: tables[table] ?? [], error: null });
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: (t: string) => chain(t) })),
  createAdminClient: vi.fn(() => ({ from: (t: string) => chain(t) })),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));
vi.mock("@/lib/warehouse/scope", () => ({
  resolveWarehouseScope: () => ({ marketId: "m-tn", marketCode: "tn", currency: "TND" }),
}));
const siteFilter = vi.fn();
vi.mock("@/lib/warehouse/site-scope", () => ({ resolveSiteFilter: (...a: unknown[]) => siteFilter(...a) }));
vi.mock("@/lib/journal/route-errors", () => ({ withRouteErrors: (_p: string, _m: string, h: unknown) => h }));

const accounts = vi.fn();
vi.mock("@/lib/carriers/xdelivery/production", () => ({
  loadXDeliveryPortalAccounts: (...a: unknown[]) => accounts(...a),
  buildPickupBatchDeps: (_admin: unknown, account: unknown) => ({ account }),
}));
vi.mock("@/lib/carriers/xdelivery/portal", () => ({ XDeliveryPortal: vi.fn() }));
const batch = vi.fn();
vi.mock("@/lib/carriers/xdelivery/pickup", async (orig) => ({
  ...(await orig<typeof import("@/lib/carriers/xdelivery/pickup")>()),
  requestPickupBatch: (...a: unknown[]) => batch(...a),
}));

import { GET, POST } from "./route";
import { PickupError } from "@/lib/carriers/xdelivery/pickup";

const url = "http://localhost/api/warehouse/xdelivery-pickup";
const get = () => GET(new NextRequest(new URL(url)));
const post = (body: unknown) => POST(new NextRequest(new URL(url), { method: "POST", body: JSON.stringify(body) }));

const account = (over: Record<string, unknown> = {}) => ({
  carrierId: "xd-1",
  marketId: "m-tn",
  warehouseId: "w-tunis",
  isActive: true,
  login: { email: "e", password: "p" },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  tables.warehouses = [{ id: "w-tunis", code: "TUN", name_fr: "Tunis" }];
  tables.orders = [
    { id: "o1", carrier_id: "xd-1", tracking_number: "611", customer_city: "Sousse", product_name: "P", quantity: 1 },
  ];
  tables.carrier_manifests = [];
  accounts.mockResolvedValue([account()]);
  mockGetActor.mockResolvedValue({ actor: { id: "u-1", role: "warehouse_agent", market_id: "m-tn" } });
  siteFilter.mockResolvedValue({ warehouseId: "w-tunis", pinned: true, unassigned: false });
  batch.mockResolvedValue({ requested: [{ orderId: "o1", barcode: "611" }], skipped: [], manifestId: "row-1" });
});

describe("GET", () => {
  test("a confirmation agent is refused", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a", role: "agent", market_id: "m-tn" } });
    expect((await get()).status).toBe(403);
  });

  test("the agent's building: what waits for the button, and whether the login is there", async () => {
    const body = await (await get()).json();
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0]).toMatchObject({ warehouseId: "w-tunis", hasPortalLogin: true, canManage: true });
    expect(body.sites[0].awaiting.map((p: { orderId: string }) => p.orderId)).toEqual(["o1"]);
  });

  test("an agent with no building sees nothing", async () => {
    siteFilter.mockResolvedValue({ warehouseId: null, pinned: true, unassigned: true });
    expect((await (await get()).json()).sites).toEqual([]);
  });

  test("another market's account is never shown", async () => {
    accounts.mockResolvedValue([account({ marketId: "m-ly" })]);
    expect((await (await get()).json()).sites).toEqual([]);
  });
});

describe("POST — the button", () => {
  test("sends the ticked parcels to the building's account, signed by the caller", async () => {
    const res = await post({ warehouse_id: "w-tunis", order_ids: ["o1", "o1", "o2"] });
    expect(res.status).toBe(200);
    expect(batch).toHaveBeenCalledWith(
      { account: expect.objectContaining({ carrierId: "xd-1" }) },
      { carrierId: "xd-1", orderIds: ["o1", "o2"], actorId: "u-1" },
    );
    expect((await res.json()).manifestId).toBe("row-1");
  });

  test("nothing ticked, or no building, is a 400", async () => {
    expect((await post({ warehouse_id: "w-tunis", order_ids: [] })).status).toBe(400);
    expect((await post({ order_ids: ["o1"] })).status).toBe(400);
    expect(batch).not.toHaveBeenCalled();
  });

  test("an agent of another building may not ask for this one", async () => {
    siteFilter.mockResolvedValue({ warehouseId: "w-sfax", pinned: true, unassigned: false });
    const res = await post({ warehouse_id: "w-tunis", order_ids: ["o1"] });
    expect(res.status).toBe(403);
    expect((await res.json()).error_code).toBe("WRONG_SITE");
  });

  test("a building with no X-Delivery account is a 404", async () => {
    const res = await post({ warehouse_id: "w-sfax", order_ids: ["o1"] });
    expect(res.status).toBe(404);
  });

  test("without the portal login, it says so instead of failing at X-Delivery", async () => {
    accounts.mockResolvedValue([account({ login: null })]);
    const res = await post({ warehouse_id: "w-tunis", order_ids: ["o1"] });
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("NO_PORTAL_LOGIN");
  });

  test("a pickup refusal keeps its code; X-Delivery down is a 502", async () => {
    batch.mockRejectedValueOnce(new PickupError("NOTHING_TO_REQUEST", "Aucun colis"));
    expect((await (await post({ warehouse_id: "w-tunis", order_ids: ["o1"] })).json()).error_code).toBe("NOTHING_TO_REQUEST");
    batch.mockRejectedValueOnce(new Error("Portail X-Delivery /manifests/collectParcels : HTTP 503"));
    expect((await post({ warehouse_id: "w-tunis", order_ids: ["o1"] })).status).toBe(502);
  });
});
