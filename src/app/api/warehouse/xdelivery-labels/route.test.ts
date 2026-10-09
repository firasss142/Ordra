import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Printing Ordra labels for X-Delivery parcels (Phase 5, prototypes/xdelivery-label-v1.html).
 * A label exists only once the parcel is uploaded (it carries their number); printing
 * records `label_prints`, which is what lets scan_order_out take the parcel.
 */

const mockGetActor = vi.fn();
const tables: Record<string, Record<string, unknown>[]> = {};
const inserts: Array<{ table: string; rows: Record<string, unknown>[] }> = [];
const filters: Array<{ table: string; op: string; args: unknown[] }> = [];
const order: string[] = [];

function chain(table: string) {
  const c: Record<string, unknown> = {};
  let rows = () => tables[table] ?? [];
  for (const op of ["select", "eq", "is", "not", "order", "limit", "gte"]) {
    c[op] = (...args: unknown[]) => {
      filters.push({ table, op, args });
      return c;
    };
  }
  c.in = (col: string, vals: unknown[]) => {
    filters.push({ table, op: "in", args: [col, vals] });
    const prev = rows;
    rows = () => prev().filter((r) => !(col in r) || vals.includes(r[col]));
    return c;
  };
  c.maybeSingle = () => Promise.resolve({ data: rows()[0] ?? null, error: null });
  c.insert = (r: Record<string, unknown>[]) => {
    order.push("insert");
    inserts.push({ table, rows: r });
    return Promise.resolve({ error: null });
  };
  c.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows(), error: null });
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
vi.mock("@/lib/carriers/dispatch", () => ({
  buildConfig: (row: { api_credentials: string }) => ({ apiCredentials: JSON.parse(row.api_credentials) }),
}));
vi.mock("@/lib/labels/xdelivery-label-images", () => ({
  xdeliveryLabelImages: async () => ({ barcodePng: "data:image/png;base64,x", qrPng: "data:image/png;base64,y" }),
}));
const rendered: Array<{ format: string; labels: Array<{ orderId: string; open: string; items: string[] }> }> = [];
vi.mock("@react-pdf/renderer", () => ({
  renderToBuffer: async (el: { props: { labels: never[]; format: string } }) => {
    order.push("render");
    rendered.push({ format: el.props.format, labels: el.props.labels });
    return Buffer.from("%PDF-1.4 fake");
  },
}));
vi.mock("@/lib/labels/XDeliveryLabelPdf", () => ({
  XDeliveryLabelPdf: () => null,
  XDELIVERY_LABEL_FORMATS: { a4x2: {}, thermal: {} },
}));

import { GET, POST } from "./route";

const url = "http://localhost/api/warehouse/xdelivery-labels";
const get = () => GET(new NextRequest(new URL(url)));
const post = (body: unknown) => POST(new NextRequest(new URL(url), { method: "POST", body: JSON.stringify(body) }));

const uploaded = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  carrier_id: "xd-1",
  market_id: "m-tn",
  status: "uploaded",
  external_id: id.toUpperCase(),
  tracking_number: `6117912177000${id.slice(-2)}`,
  customer_name: "Client",
  customer_phone: "22123456",
  customer_city: "Sousse",
  customer_address: "Rue",
  total_price: 89.9,
  product_name: "Pantalon",
  variant_label: "M",
  quantity: 1,
  carrier_extra: null,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  inserts.length = 0;
  filters.length = 0;
  rendered.length = 0;
  order.length = 0;
  tables.carriers = [{ id: "xd-1", warehouse_id: "w-tunis", api_credentials: JSON.stringify({ is_opened: "1" }) }];
  tables.orders = [uploaded("o-01"), uploaded("o-02")];
  tables.order_items = [];
  tables.label_prints = [];
  tables.markets = [{ id: "m-tn", sender_name: "Boutique Exemple", sender_phone: "71 000 000" }];
  mockGetActor.mockResolvedValue({ actor: { id: "u-1", role: "warehouse_agent", market_id: "m-tn" } });
  siteFilter.mockResolvedValue({ warehouseId: "w-tunis", pinned: true, unassigned: false });
});

describe("GET — what the desk and the bench show", () => {
  test("a confirmation agent is refused", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a-1", role: "agent", market_id: "m-tn" } });
    expect((await get()).status).toBe(403);
  });

  test("uploaded X-Delivery parcels without a print are « à imprimer »; printed ones carry their time", async () => {
    tables.label_prints = [{ order_id: "o-02", batch_id: "b-1", created_at: "2026-10-06T08:12:00Z", orders: { carrier_id: "xd-1" } }];
    const body = await (await get()).json();
    expect(body.toPrint).toEqual(["o-01"]);
    expect(body.printed).toEqual({ "o-02": "2026-10-06T08:12:00Z" });
    expect(body.lastBatch).toMatchObject({ at: "2026-10-06T08:12:00Z", count: 1, orderIds: ["o-02"] });
  });

  test("reads only uploaded parcels of X-Delivery accounts", async () => {
    await get();
    expect(filters).toContainEqual({ table: "carriers", op: "eq", args: ["code", "xdelivery"] });
    expect(filters).toContainEqual({ table: "orders", op: "eq", args: ["status", "uploaded"] });
  });

  test("an unassigned agent sees nothing", async () => {
    siteFilter.mockResolvedValue({ warehouseId: null, pinned: true, unassigned: true });
    const body = await (await get()).json();
    expect(body).toEqual({ enabled: false, toPrint: [], printed: {}, lastBatch: null });
  });

  test("a site with an X-Delivery account says so, even with nothing to print", async () => {
    tables.orders = [];
    expect(await (await get()).json()).toMatchObject({ enabled: true, toPrint: [] });
  });
});

describe("POST — print", () => {
  test("only the two kept formats", async () => {
    expect((await post({ format: "a6" })).status).toBe(400);
  });

  test("without ids: every label still to print, in one PDF", async () => {
    const res = await post({ format: "a4x2" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(rendered[0].format).toBe("a4x2");
    expect(rendered[0].labels.map((l) => l.orderId)).toEqual(["o-01", "o-02"]);
  });

  test("the PDF is made BEFORE the print is recorded — a failed render must not unlock scan-out", async () => {
    await post({ format: "thermal" });
    expect(order).toEqual(["render", "insert"]);
  });

  test("records one label_prints row per parcel, by the caller, in one batch, with no BL number", async () => {
    await post({ format: "thermal" });
    const rows = inserts.find((i) => i.table === "label_prints")!.rows;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ order_id: "o-01", market_id: "m-tn", printed_by: "u-1", is_reprint: false, bl_number: null });
    expect(rows[0].batch_id).toBe(rows[1].batch_id);
  });

  test("a parcel printed before is a reprint", async () => {
    tables.label_prints = [{ order_id: "o-02", batch_id: "b-1", created_at: "2026-10-06T08:12:00Z", orders: { carrier_id: "xd-1" } }];
    await post({ order_ids: ["o-02"], format: "a4x2" });
    expect(inserts[0].rows).toEqual([expect.objectContaining({ order_id: "o-02", is_reprint: true })]);
  });

  test("« Ouvrir le colis » follows the account, the items come from order_items", async () => {
    tables.order_items = [{ order_id: "o-01", product_name: "Robe", variant_label: "S", quantity: 2 }];
    await post({ order_ids: ["o-01"], format: "a4x2" });
    expect(rendered[0].labels[0]).toMatchObject({ open: "OUI", items: ["2× Robe S"] });
  });

  test("nothing printable → 404, and nothing recorded", async () => {
    tables.orders = [];
    expect((await post({ format: "a4x2" })).status).toBe(404);
    expect(inserts).toEqual([]);
  });
});
