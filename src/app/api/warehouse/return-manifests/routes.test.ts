import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The return-list routes (docs/xdelivery-manifests.md). The decisions live in the
 * RPCs (supabase/tests/carrier_manifests_test.sql proves them under a real JWT);
 * here: the input gates, that the caller's own session signs, and the error mapping.
 */

const mockGetActor = vi.fn();
const rpc = vi.fn();
const tables: Record<string, Record<string, unknown>[]> = {};
const filters: Array<{ table: string; op: string; args: unknown[] }> = [];

function chain(table: string) {
  const c: Record<string, unknown> = {};
  let rows = () => tables[table] ?? [];
  for (const op of ["select", "in", "is", "gte", "order", "limit", "or"]) {
    c[op] = (...args: unknown[]) => {
      filters.push({ table, op, args });
      return c;
    };
  }
  c.eq = (col: string, val: unknown) => {
    filters.push({ table, op: "eq", args: [col, val] });
    const prev = rows;
    rows = () => prev().filter((r) => !(col in r) || r[col] === val);
    return c;
  };
  c.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null, count: rows().length });
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: (t: string) => chain(t), rpc: (...a: unknown[]) => rpc(...a) })),
  createAdminClient: vi.fn(() => ({})),
}));
vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));
vi.mock("@/lib/warehouse/scope", () => ({
  resolveWarehouseScope: () => ({ marketId: "m-tn", marketCode: "tn", currency: "TND" }),
}));
const siteFilter = vi.fn();
vi.mock("@/lib/warehouse/site-scope", () => ({ resolveSiteFilter: (...a: unknown[]) => siteFilter(...a) }));
vi.mock("@/lib/journal/route-errors", () => ({ withRouteErrors: (_p: string, _m: string, h: unknown) => h }));
const refresh = vi.fn();
vi.mock("@/lib/carriers/manifests/refresh", () => ({ refreshManifestsFor: (...a: unknown[]) => refresh(...a) }));

import { GET as LIST } from "./route";
import { POST as SCAN } from "./[id]/scan/route";
import { POST as DAMAGED } from "./[id]/damaged/route";
import { POST as CLOSE } from "./[id]/close/route";
import { POST as OPEN } from "./open/route";

const base = "http://localhost/api/warehouse/return-manifests";
const req = (path: string, body?: unknown) =>
  new NextRequest(new URL(base + path), body === undefined ? undefined : { method: "POST", body: JSON.stringify(body) });
const ctx = { params: { id: "m-1" } };

beforeEach(() => {
  vi.clearAllMocks();
  filters.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  mockGetActor.mockResolvedValue({ actor: { id: "u-1", role: "warehouse_agent", market_id: "m-tn" } });
  siteFilter.mockResolvedValue({ warehouseId: "w-tunis", pinned: true, unassigned: false });
  rpc.mockResolvedValue({ data: { result: "received", received: 1, expected: 10, set_aside: 0 }, error: null });
  refresh.mockResolvedValue({ accounts: 1, lists: 1, released: 0, errors: 0 });
});

describe("scan", () => {
  test("a scan reaches the RPC with every space gone, signed by the caller", async () => {
    const res = await SCAN(req("/m-1/scan", { code: " 6117 9140 0000 001 " }), ctx);
    expect(res.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("scan_manifest_return", { p_manifest_id: "m-1", p_code: "611791400000001", p_actor_id: "u-1" });
    expect((await res.json()).result).toBe("received");
  });

  test("an empty code never reaches the database", async () => {
    expect((await SCAN(req("/m-1/scan", { code: "  " }), ctx)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("a refusal carries the RPC's code and its status", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Ce colis est « livré »", details: '{"code":"DELIVERED_CONFLICT"}' } });
    const res = await SCAN(req("/m-1/scan", { code: "611" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error_code).toBe("DELIVERED_CONFLICT");
  });

  test("a confirmation agent cannot scan returns", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a", role: "agent", market_id: "m-tn" } });
    expect((await SCAN(req("/m-1/scan", { code: "611" }), ctx)).status).toBe(403);
  });
});

describe("damaged", () => {
  test("needs a known reason, and a note for « autre »", async () => {
    expect((await DAMAGED(req("/m-1/damaged", { parcel_id: "p1", return_reason: "nope" }), ctx)).status).toBe(400);
    expect((await DAMAGED(req("/m-1/damaged", { parcel_id: "p1", return_reason: "other" }), ctx)).status).toBe(400);
    expect((await DAMAGED(req("/m-1/damaged", { return_reason: "carrier_damage" }), ctx)).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test("passes the reason and the trimmed note to the correction RPC", async () => {
    await DAMAGED(req("/m-1/damaged", { parcel_id: "p1", return_reason: "other", note: "  boîte écrasée " }), ctx);
    expect(rpc).toHaveBeenCalledWith("mark_manifest_return_damaged", {
      p_parcel_id: "p1",
      p_actor_id: "u-1",
      p_return_reason: "other",
      p_note: "boîte écrasée",
    });
  });

  test("a closed list refuses the correction with its code", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "La liste est clôturée", details: '{"code":"MANIFEST_CLOSED"}' } });
    const res = await DAMAGED(req("/m-1/damaged", { parcel_id: "p1", return_reason: "carrier_damage" }), ctx);
    expect((await res.json()).error_code).toBe("MANIFEST_CLOSED");
  });
});

describe("close", () => {
  test("closes under the caller's name and answers the missing lines", async () => {
    rpc.mockResolvedValueOnce({ data: { missing_count: 2, missing: [] }, error: null });
    const res = await CLOSE(req("/m-1/close", {}), ctx);
    expect(rpc).toHaveBeenCalledWith("close_return_manifest", { p_manifest_id: "m-1", p_actor_id: "u-1" });
    expect((await res.json()).missing_count).toBe(2);
  });
});

describe("open by scan", () => {
  test("the sheet's barcode opens its list", async () => {
    tables.carrier_manifests = [{ id: "m-1", code: "1791400000001" }];
    const res = await OPEN(req("/open", { code: "1791 4000 0000 1" }));
    expect(await res.json()).toEqual({ manifest_id: "m-1", matched: "sheet" });
    expect(refresh).not.toHaveBeenCalled();
  });

  test("a parcel's barcode opens the list that holds it", async () => {
    tables.carrier_manifests = [];
    tables.carrier_manifest_parcels = [{ manifest_id: "m-2", barcode: "611" }];
    expect(await (await OPEN(req("/open", { code: "611" }))).json()).toEqual({ manifest_id: "m-2", matched: "parcel" });
  });

  test("our QR (an order id) is looked up by order, not by barcode", async () => {
    const id = "6F1C2A9E-0000-4000-8000-000000001042";
    tables.carrier_manifests = [];
    tables.carrier_manifest_parcels = [{ manifest_id: "m-3", order_id: id.toLowerCase() }];
    await OPEN(req("/open", { code: id }));
    expect(filters).toContainEqual({ table: "carrier_manifest_parcels", op: "eq", args: ["order_id", id.toLowerCase()] });
  });

  test("unknown: fetch the lists now for the caller's building, then try once more", async () => {
    tables.carrier_manifests = [];
    tables.carrier_manifest_parcels = [];
    const res = await OPEN(req("/open", { code: "999" }));
    expect(refresh).toHaveBeenCalledWith({}, { marketId: "m-tn", warehouseId: "w-tunis" });
    expect(res.status).toBe(404);
    expect((await res.json()).error_code).toBe("MANIFEST_NOT_FOUND");
  });

  test("an agent with no building opens nothing and fetches nothing", async () => {
    siteFilter.mockResolvedValue({ warehouseId: null, pinned: true, unassigned: true });
    expect((await OPEN(req("/open", { code: "611" }))).status).toBe(403);
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("list", () => {
  test("counts progress per list and the totals", async () => {
    tables.carrier_manifests = [
      {
        id: "m-1",
        kind: "return",
        carrier_id: "c1",
        code: "S1",
        carrier_created_at: "2026-10-08T09:00:00Z",
        carrier_status: "ACCEPTED",
        closed_at: null,
        carrier_manifest_parcels: [
          { state: "received", order_id: "o1" },
          { state: "expected", order_id: "o2" },
        ],
      },
    ];
    tables.return_set_asides = [{ id: "s1" }];
    const body = await (await LIST(req(""))).json();
    expect(body.manifests[0]).toMatchObject({ id: "m-1", received: 1, remaining: 1, state: "in_progress" });
    expect(body.totals).toEqual({ toReceive: 1, missing: 0, setAside: 1, openLists: 1 });
  });

  test("an agent is narrowed to their building (or lists with no building)", async () => {
    tables.carrier_manifests = [];
    await LIST(req(""));
    expect(filters).toContainEqual({ table: "carrier_manifests", op: "or", args: ["warehouse_id.is.null,warehouse_id.eq.w-tunis"] });
  });

  test("an agent with no building sees nothing", async () => {
    siteFilter.mockResolvedValue({ warehouseId: null, pinned: true, unassigned: true });
    expect((await (await LIST(req(""))).json()).manifests).toEqual([]);
  });
});
