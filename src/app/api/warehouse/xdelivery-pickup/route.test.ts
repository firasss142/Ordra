import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * The X-Delivery pickup switch endpoint (owner decision 6). Its own key, its own rule:
 * a warehouse agent turns their site OFF and back ON; Darb's switch is never touched.
 */

const mockGetActor = vi.fn();
const tables: Record<string, Record<string, unknown>[]> = {};
const upserts: Array<{ table: string; row: Record<string, unknown> }> = [];
const filters: Array<{ table: string; op: string; args: unknown[] }> = [];

// RLS: `settings` is readable by super_admin and market managers only, so a warehouse
// agent's own client gets no rows there.
function chain(table: string, client: "user" | "admin" = "admin") {
  const c: Record<string, unknown> = {};
  const rows = () => (client === "user" && table === "settings" ? [] : tables[table] ?? []);
  for (const op of ["select", "eq", "in", "is", "like", "gte", "order", "limit", "not", "or"]) {
    c[op] = (...args: unknown[]) => {
      filters.push({ table, op, args });
      return c;
    };
  }
  c.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  c.upsert = (row: Record<string, unknown>) => {
    upserts.push({ table, row });
    return Promise.resolve({ error: null });
  };
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null });
  return c;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: (t: string) => chain(t, "user") })),
  createAdminClient: vi.fn(() => ({ from: (t: string) => chain(t) })),
}));

vi.mock("@/lib/auth/actor", () => ({
  getActor: (...a: unknown[]) => mockGetActor(...a),
}));

vi.mock("@/lib/warehouse/scope", () => ({
  resolveWarehouseScope: () => ({ marketId: "m-tn", marketCode: "tn", currency: "TND" }),
}));

const siteFilter = vi.fn();
vi.mock("@/lib/warehouse/site-scope", () => ({
  resolveSiteFilter: (...a: unknown[]) => siteFilter(...a),
}));

vi.mock("@/lib/journal/route-errors", () => ({
  withRouteErrors: (_p: string, _m: string, h: unknown) => h,
}));

import { GET, POST } from "./route";

const url = "http://localhost/api/warehouse/xdelivery-pickup";
const get = () => GET(new NextRequest(new URL(url)));
const post = (body: unknown) =>
  POST(new NextRequest(new URL(url), { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  upserts.length = 0;
  filters.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  tables.warehouses = [
    { id: "w-tunis", code: "tunis", name_fr: "Tunis", name_ar: "تونس", market_id: "m-tn", is_active: true },
  ];
  tables.carriers = [{ id: "xd-1", warehouse_id: "w-tunis" }];
  tables.settings = [];
  tables.orders = [];
  tables.carrier_event_log = [];
  mockGetActor.mockResolvedValue({ actor: { id: "u-1", role: "warehouse_agent", market_id: "m-tn" } });
  siteFilter.mockResolvedValue({ warehouseId: "w-tunis", pinned: true, unassigned: false });
});

describe("GET", () => {
  test("a confirmation agent is refused", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a-1", role: "agent", market_id: "m-tn" } });
    expect((await get()).status).toBe(403);
  });

  test("the agent's site, ON, with its X-Delivery parcels", async () => {
    tables.orders = [
      {
        id: "o-1",
        carrier_id: "xd-1",
        tracking_number: "611791210000001",
        customer_city: "Sousse",
        product_name: "Pantalon M",
        quantity: 1,
        carrier_status_slug: null,
      },
    ];
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sites).toHaveLength(1);
    expect(body.sites[0]).toMatchObject({ warehouseId: "w-tunis", name: "Tunis", disabled: false, canToggle: true, waiting: 1 });
  });

  test("the agent sees their own press — the switch is read past RLS, which hides settings from them", async () => {
    tables.settings = [
      { key: "xdelivery_pickup_disabled:w-tunis", value: { disabled_at: new Date().toISOString() } },
    ];
    const body = await (await get()).json();
    expect(body.sites[0].disabled).toBe(true);
  });

  test("reads only X-Delivery accounts and only scanned parcels", async () => {
    await get();
    expect(filters).toContainEqual({ table: "carriers", op: "eq", args: ["code", "xdelivery"] });
    expect(filters).toContainEqual({ table: "orders", op: "eq", args: ["status", "scanned"] });
  });

  test("an unassigned agent sees no card — unassigned never means unrestricted", async () => {
    siteFilter.mockResolvedValue({ warehouseId: null, pinned: true, unassigned: true });
    const body = await (await get()).json();
    expect(body.sites).toEqual([]);
  });

  test("no X-Delivery account → no card", async () => {
    tables.carriers = [];
    const body = await (await get()).json();
    expect(body.sites).toEqual([]);
  });
});

describe("POST", () => {
  test("rejects a body without warehouse_id + boolean disabled", async () => {
    expect((await post({ warehouse_id: "w-tunis" })).status).toBe(400);
  });

  test("an agent turns their site OFF: the stamp is written under X-Delivery's own key", async () => {
    const res = await post({ warehouse_id: "w-tunis", disabled: true });
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].row).toMatchObject({ market_id: "m-tn", key: "xdelivery_pickup_disabled:w-tunis" });
    expect((upserts[0].row.value as { disabled_at: string }).disabled_at).toMatch(/^\d{4}-/);
  });

  test("…and back ON (unlike Darb's switch): the stamp is erased", async () => {
    const res = await post({ warehouse_id: "w-tunis", disabled: false });
    expect(res.status).toBe(200);
    expect(upserts[0].row).toMatchObject({ key: "xdelivery_pickup_disabled:w-tunis", value: {} });
  });

  test("an agent of another site may not touch it", async () => {
    siteFilter.mockResolvedValue({ warehouseId: "w-sfax", pinned: true, unassigned: false });
    expect((await post({ warehouse_id: "w-tunis", disabled: true })).status).toBe(403);
    expect(upserts).toEqual([]);
  });

  test("a site without an X-Delivery account has no switch", async () => {
    tables.carriers = [];
    expect((await post({ warehouse_id: "w-tunis", disabled: true })).status).toBe(404);
    expect(upserts).toEqual([]);
  });

  test("a site of another market is unknown", async () => {
    tables.warehouses = [{ id: "w-tunis", market_id: "m-ly", is_active: true }];
    expect((await post({ warehouse_id: "w-tunis", disabled: true })).status).toBe(404);
  });
});
