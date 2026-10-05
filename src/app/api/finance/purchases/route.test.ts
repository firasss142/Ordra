import { describe, test, expect, vi, beforeEach } from "vitest";

const mockGetActor = vi.fn();
const mockLoadStock = vi.fn();
const tables: Record<string, { data: unknown[]; error: unknown }> = {};
/** every `.eq(col, value)` the route asked, per table — to prove the market scope */
const eqCalls: Array<[string, string, unknown]> = [];

/**
 * One fake client for every table. Each chain is thenable: the route may chain
 * `.eq()` / `.order()` as it likes, the `await` resolves — the test does not
 * impose a query shape on the code.
 */
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({
    from: (table: string) => {
      const result = tables[table] ?? { data: [], error: null };
      const chain: Record<string, unknown> = {
        then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej),
      };
      for (const m of ["select", "in", "order", "not", "is", "gte", "lte", "limit", "neq"]) {
        chain[m] = vi.fn().mockReturnValue(chain);
      }
      chain.eq = vi.fn((col: string, value: unknown) => {
        eqCalls.push([table, col, value]);
        return chain;
      });
      return chain;
    },
  }),
}));

vi.mock("@/lib/auth/actor", () => ({ getActor: (...a: unknown[]) => mockGetActor(...a) }));
vi.mock("@/lib/finance/stock/load", () => ({ loadStockPage: (...a: unknown[]) => mockLoadStock(...a) }));

import { GET } from "./route";
import { NextRequest } from "next/server";

const LY = "00000000-0000-0000-0000-000000000002";
const TN = "00000000-0000-0000-0000-000000000001";

function req(qs = "") {
  return new NextRequest(new URL(`http://localhost/api/finance/purchases${qs}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  eqCalls.length = 0;
  vi.setSystemTime(new Date("2026-10-04T15:00:00Z"));

  tables.warehouses = { data: [{ id: "w-tri", name_fr: "Tripoli", name_ar: "طرابلس", is_default: true, code: "TRI" }], error: null };
  tables.suppliers = {
    data: [
      { id: "s-nour", name: "Imprimerie Al-Nour", category: "Livres", city: "Tripoli", is_active: true },
      { id: "s-dak", name: "Dar Al-Kitab", category: "Livres", city: "Benghazi", is_active: true },
    ],
    error: null,
  };
  tables.receptions = {
    data: [
      {
        id: "r-31", reference: "REC-LY-2026-0031", status: "settled", warehouse_id: "w-tri", arrival_date: "2026-09-12",
        created_at: "2026-09-12T08:00:00Z", settled_at: "2026-09-12T10:00:00Z", supplier_id: "s-nour", supplier_name: null,
        supplier_ref: null, invoice_total: 18600, due_at: "2026-09-22", fee_basis: "value",
        counted_by_user: { full_name: "Adel" },
        reception_payments: [{ amount: 14400 }], reception_costs: [],
        reception_lines: [{ id: "l-31", product_id: "p-tad", received_qty: 300, damaged_qty: 0, unit_cost: 62, product: { name: "Tadabbur" }, variant: null }],
      },
      {
        id: "r-34", reference: "REC-LY-2026-0034", status: "settled", warehouse_id: "w-tri", arrival_date: "2026-09-28",
        created_at: "2026-09-28T08:00:00Z", settled_at: "2026-09-28T10:00:00Z", supplier_id: "s-dak", supplier_name: null,
        supplier_ref: "F-88", invoice_total: 7626, due_at: "2026-10-22", fee_basis: "value", counted_by_user: null,
        reception_payments: [{ amount: 2980 }], reception_costs: [],
        reception_lines: [{ id: "l-34", product_id: "p-mal", received_qty: 180, damaged_qty: 6, unit_cost: 41, product: { name: "Le mal et le remède" }, variant: null }],
      },
      {
        id: "r-open", reference: null, status: "open", warehouse_id: "w-tri", arrival_date: "2026-10-01",
        created_at: "2026-10-01T09:15:00Z", settled_at: null, supplier_id: null, supplier_name: null, supplier_ref: null,
        invoice_total: null, due_at: null, fee_basis: "value", counted_by_user: { full_name: "Adel" },
        reception_payments: [], reception_costs: [{ id: "c1", kind: "freight", amount: 180 }],
        reception_lines: [{ id: "lo-1", product_id: "p-mem", received_qty: 200, damaged_qty: 0, unit_cost: null, product: { name: "Mémoriser facilement" }, variant: null }],
      },
    ],
    error: null,
  };
  tables.supplier_claims = {
    data: [{ id: "cl-1", market_id: LY, supplier_id: "s-dak", reception_id: "r-34", kind: "damaged", amount: 246, units: 6, status: "open", opened_at: "2026-09-28T11:00:00Z" }],
    error: null,
  };
  tables.purchase_orders = {
    data: [{ id: "po-11", reference: "BC-LY-2026-0011", market_id: LY, warehouse_id: "w-tri", supplier_id: "s-nour", status: "open", wanted_by: "2026-10-08", ordered_at: "2026-09-25T08:00:00Z", closed_at: null, close_reason: null, note: null }],
    error: null,
  };
  tables.purchase_order_line_progress = {
    data: [{ id: "pol-11", purchase_order_id: "po-11", product_id: "p-mem", variant_id: null, ordered_qty: 200, unit_cost: 48, received_qty: 200, first_received_at: "2026-10-01T09:15:00Z", products: { name: "Mémoriser facilement" }, product_variants: null }],
    error: null,
  };
  tables.purchase_order_receipts = {
    data: [{ reception_line_id: "lo-1", purchase_order_lines: { unit_cost: 48, purchase_orders: { reference: "BC-LY-2026-0011", supplier_id: "s-nour" } } }],
    error: null,
  };
  tables.products = { data: [{ id: "p-mem", name: "Mémoriser facilement" }, { id: "p-tad", name: "Tadabbur" }], error: null };

  mockLoadStock.mockResolvedValue({
    sites: [{ id: "w-tri", rebuy: [{ id: "p-tad", name: "Tadabbur", days: 17, buy: { qty: 250, cost: 15500 } }, { id: "p-ok", name: "Couvert", days: 40, buy: null }] }],
  });
  mockGetActor.mockResolvedValue({ actor: { id: "sa", role: "super_admin", market_id: null } });
});

describe("GET /api/finance/purchases — who gets in (owner + market managers)", () => {
  test("a warehouse agent does not: money is not dock information", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "w", role: "warehouse_agent", market_id: LY } });
    expect((await GET(req(`?market_id=${LY}`))).status).toBe(403);
  });

  test("nor an agent", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "a", role: "agent", market_id: LY } });
    expect((await GET(req(`?market_id=${LY}`))).status).toBe(403);
  });

  test("a market manager does — on their own market, whatever market the URL names", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "mm", role: "market_manager", market_id: LY } });
    const res = await GET(req(`?market_id=${TN}`));
    expect(res.status).toBe(200);
    const scoped = eqCalls.filter(([, col]) => col === "market_id").map(([, , v]) => v);
    expect(scoped.length).toBeGreaterThan(0);
    expect(new Set(scoped)).toEqual(new Set([LY]));
    expect((await res.json()).currency).toBe("LYD");
  });

  test("a manager without a market gets nothing", async () => {
    mockGetActor.mockResolvedValue({ actor: { id: "mm", role: "market_manager", market_id: null } });
    expect((await GET(req(`?market_id=${LY}`))).status).toBe(400);
  });

  test("the super_admin must name a market — they have none", async () => {
    expect((await GET(req())).status).toBe(400);
  });
});

describe("GET /api/finance/purchases — the page's four lists", () => {
  test("owes invoice − paid − held, late first", async () => {
    const body = await (await GET(req(`?market_id=${LY}`))).json();
    expect(body.tiles.owed).toBe(4200 + 4400);
    expect(body.tiles.late).toBe(4200);
    expect(body.bills.map((b: { ref: string }) => b.ref)).toEqual(["REC-LY-2026-0031", "REC-LY-2026-0034"]);
    expect(body.bills[1]).toMatchObject({ held: 246, heldOpen: true, heldUnits: 6 });
    expect(body.today).toBe("2026-10-04");
  });

  test("lists the open arrival with the order's price and supplier pre-filled", async () => {
    const body = await (await GET(req(`?market_id=${LY}`))).json();
    expect(body.arrivals).toHaveLength(1);
    expect(body.arrivals[0]).toMatchObject({ supplierId: "s-nour", poRefs: ["BC-LY-2026-0011"], countedBy: "Adel", fees: { freight: 180, customs: 0, other: 0 } });
    expect(body.arrivals[0].lines[0]).toMatchObject({ name: "Mémoriser facilement", price: 48, hint: { kind: "po", value: 48 } });
  });

  test("carries open orders, suppliers with their open claim, and the restock suggestions", async () => {
    const body = await (await GET(req(`?market_id=${LY}`))).json();
    expect(body.orders.map((o: { ref: string }) => o.ref)).toEqual(["BC-LY-2026-0011"]);
    expect(body.orders[0]).toMatchObject({ ordered: 200, received: 200, total: 9600, state: "partial" });
    expect(body.suppliers.find((s: { id: string }) => s.id === "s-dak").claims).toHaveLength(1);
    expect(body.suggestions).toEqual([{ productId: "p-tad", name: "Tadabbur", siteId: "w-tri", siteName: "Tripoli", qty: 250, value: 15500, days: 17 }]);
    expect(body.warehouses).toEqual([{ id: "w-tri", name: "Tripoli", isDefault: true }]);
  });

  test("names the warehouses in Arabic for an Arabic reader", async () => {
    const body = await (await GET(req(`?market_id=${LY}&locale=ar`))).json();
    expect(body.warehouses[0].name).toBe("طرابلس");
  });

  test("still answers when the stock suggestions cannot be computed", async () => {
    mockLoadStock.mockRejectedValue(new Error("rpc"));
    const res = await GET(req(`?market_id=${LY}`));
    expect(res.status).toBe(200);
    expect((await res.json()).suggestions).toEqual([]);
  });

  test("fails loudly when the receptions cannot be read — never an empty « nothing owed »", async () => {
    tables.receptions = { data: [], error: { message: "boom" } };
    expect((await GET(req(`?market_id=${LY}`))).status).toBe(500);
  });
});
