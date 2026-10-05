import { describe, expect, it } from "vitest";
import { buildPurchasesView, type PurchasesInput, type ReceptionIn } from "./model";
import type { PurchaseOrderRow } from "@/lib/purchases/orders";

/*
 * The plan's shared sheet, cut down: today is Sunday 4 October 2026 in Libya.
 * Al-Nour is 12 days late, Guangzhou is due this week, Dar Al-Kitab later with
 * 246 held in an open claim. One arrival from the dock is waiting to be priced.
 */
const TODAY = "2026-10-04";

function rec(over: Partial<ReceptionIn> & { id: string }): ReceptionIn {
  return {
    reference: null,
    status: "settled",
    warehouseId: "w-tri",
    arrivalDate: "2026-09-12",
    createdAt: "2026-09-12T08:00:00Z",
    settledAt: "2026-09-12T10:00:00Z",
    countedBy: null,
    supplierId: null,
    supplierName: null,
    supplierRef: null,
    invoiceTotal: null,
    dueAt: null,
    feeBasis: "value",
    payments: [],
    costs: [],
    lines: [],
    ...over,
  };
}

function po(over: Partial<PurchaseOrderRow> & { id: string }): PurchaseOrderRow {
  return {
    reference: `BC-${over.id}`,
    market_id: "m-ly",
    warehouse_id: "w-tri",
    warehouse_name: null,
    supplier_id: "s-nour",
    supplier_name: null,
    status: "open",
    wanted_by: null,
    ordered_at: "2026-09-20T08:00:00Z",
    ordered_by_name: null,
    closed_at: null,
    close_reason: null,
    note: null,
    lines: [],
    ...over,
  };
}

function input(over: Partial<PurchasesInput> = {}): PurchasesInput {
  return {
    today: TODAY,
    warehouses: [
      { id: "w-tri", name: "Tripoli" },
      { id: "w-bgz", name: "Benghazi" },
    ],
    suppliers: [
      { id: "s-nour", name: "Imprimerie Al-Nour", category: "Livres", city: "Tripoli", isActive: true },
      { id: "s-gz", name: "Guangzhou Sports Co.", category: "Sport", city: "Chine", isActive: true },
      { id: "s-dak", name: "Dar Al-Kitab", category: "Livres", city: "Benghazi", isActive: true },
      { id: "s-old", name: "Ancien", category: null, city: null, isActive: false },
    ],
    receptions: [
      rec({
        id: "r-31", reference: "REC-LY-2026-0031", supplierId: "s-nour", invoiceTotal: 18600, dueAt: "2026-09-22",
        payments: [{ amount: 14400 }],
        lines: [{ id: "l-31", productId: "p-tad", name: "Tadabbur", variant: null, received: 300, damaged: 0, unitCost: 62 }],
      }),
      rec({
        id: "r-40", reference: "REC-LY-2026-0040", supplierId: "s-gz", invoiceTotal: 6100, dueAt: "2026-10-07",
        arrivalDate: "2026-10-01", settledAt: "2026-10-01T10:00:00Z",
        lines: [{ id: "l-40", productId: "p-sac", name: "Sac de frappe", variant: null, received: 64, damaged: 0, unitCost: 95 }],
      }),
      rec({
        id: "r-34", reference: "REC-LY-2026-0034", supplierId: "s-dak", warehouseId: "w-bgz", invoiceTotal: 7626, dueAt: "2026-10-22",
        arrivalDate: "2026-09-28", settledAt: "2026-09-28T10:00:00Z",
        payments: [{ amount: 1000 }, { amount: 1980 }],
        lines: [{ id: "l-34", productId: "p-mal", name: "Le mal et le remède", variant: null, received: 180, damaged: 6, unitCost: 41 }],
      }),
      // fully paid: not a bill
      rec({ id: "r-20", reference: "REC-LY-2026-0020", supplierId: "s-nour", invoiceTotal: 500, dueAt: "2026-09-01", payments: [{ amount: 500 }] }),
      // settled without an invoice: owed but unknown
      rec({ id: "r-21", reference: "REC-LY-2026-0021", supplierId: "s-gz", invoiceTotal: null }),
      // reversed: neither a bill nor an arrival
      rec({ id: "r-22", reference: "REC-LY-2026-0022", status: "reversed", supplierId: "s-nour", invoiceTotal: 999, dueAt: "2026-09-01" }),
      // from the dock, not priced yet
      rec({
        id: "r-open", status: "open", warehouseId: "w-tri", arrivalDate: "2026-10-01", settledAt: null, countedBy: "Adel",
        createdAt: "2026-10-01T09:15:00Z", feeBasis: "units",
        costs: [{ id: "c1", kind: "freight", amount: 120 }, { id: "c2", kind: "freight", amount: 60 }, { id: "c3", kind: "handling", amount: 15 }],
        lines: [
          { id: "lo-1", productId: "p-mem", name: "Mémoriser facilement", variant: null, received: 200, damaged: 0, unitCost: null },
          { id: "lo-2", productId: "p-tad", name: "Tadabbur", variant: "Grand", received: 10, damaged: 2, unitCost: null },
          { id: "lo-3", productId: "p-new", name: "Nouveau", variant: null, received: 5, damaged: 0, unitCost: 7.5 },
          { id: "lo-4", productId: "p-x", name: "Jamais", variant: null, received: 0, damaged: 0, unitCost: null },
        ],
      }),
      // an open group where nothing was counted yet: nothing to settle
      rec({ id: "r-empty", status: "open", settledAt: null, lines: [] }),
    ],
    claims: [
      { id: "cl-1", supplierId: "s-dak", receptionId: "r-34", kind: "damaged", amount: 246, units: 6, status: "open", openedAt: "2026-09-28T11:00:00Z" },
    ],
    orders: [
      po({
        id: "po-11", reference: "BC-LY-2026-0011", supplier_id: "s-nour", wanted_by: "2026-10-08",
        lines: [{ id: "pol-11", product_id: "p-mem", product_name: "Mémoriser facilement", variant_id: null, variant_label: null, ordered_qty: 200, unit_cost: 48, received_qty: 0, first_received_at: null }],
      }),
      po({
        id: "po-15", reference: "BC-LY-2026-0015", supplier_id: "s-dak", warehouse_id: "w-bgz", wanted_by: "2026-10-10",
        lines: [{ id: "pol-15", product_id: "p-mal", product_name: "Le mal et le remède", variant_id: null, variant_label: null, ordered_qty: 300, unit_cost: 41, received_qty: 186, first_received_at: "2026-09-28T08:00:00Z" }],
      }),
      po({
        id: "po-09", reference: "BC-LY-2026-0009", supplier_id: "s-gz", wanted_by: "2026-09-30",
        lines: [{ id: "pol-09", product_id: "p-sac", product_name: "Sac de frappe", variant_id: null, variant_label: null, ordered_qty: 160, unit_cost: null, received_qty: 0, first_received_at: null }],
      }),
      po({
        id: "po-30", reference: "BC-LY-2026-0030", supplier_id: "s-gz", wanted_by: "2026-11-18",
        lines: [{ id: "pol-30", product_id: "p-sac", product_name: "Sac de frappe", variant_id: null, variant_label: null, ordered_qty: 60, unit_cost: 95, received_qty: 0, first_received_at: null }],
      }),
      po({
        id: "po-01", reference: "BC-LY-2026-0001", supplier_id: "s-nour", status: "closed", ordered_at: "2026-08-01T08:00:00Z",
        lines: [{ id: "pol-01", product_id: "p-tad", product_name: "Tadabbur", variant_id: null, variant_label: null, ordered_qty: 100, unit_cost: 60, received_qty: 96, first_received_at: "2026-08-07T08:00:00Z" }],
      }),
    ],
    links: [{ receptionLineId: "lo-1", poRef: "BC-LY-2026-0011", poSupplierId: "s-nour", poLineUnitCost: 48 }],
    products: [
      { id: "p-tad", name: "Tadabbur" },
      { id: "p-mem", name: "Mémoriser facilement" },
      { id: "p-sac", name: "Sac de frappe" },
    ],
    suggestions: [{ productId: "p-tad", name: "Tadabbur", siteId: "w-bgz", qty: 250, value: 15500, days: 17 }],
    ...over,
  };
}

describe("À payer — what I owe, to whom, by when", () => {
  const v = buildPurchasesView(input());

  it("owes invoice − paid − held, on settled receptions only", () => {
    expect(v.bills.map((b) => [b.ref, b.left])).toEqual([
      ["REC-LY-2026-0031", 4200],
      ["REC-LY-2026-0040", 6100],
      ["REC-LY-2026-0034", 4400],
    ]);
    expect(v.tiles.owed).toBe(14700);
  });

  it("files each bill in late / this week / later, and counts what is late", () => {
    expect(v.bills.map((b) => b.bucket)).toEqual(["late", "week", "later"]);
    expect(v.bills[0].daysLate).toBe(12);
    expect(v.bills[1].daysLeft).toBe(3);
    expect(v.tiles.late).toBe(4200);
    expect(v.buckets).toEqual([
      { key: "late", total: 4200, count: 1, suppliers: ["Imprimerie Al-Nour"] },
      { key: "week", total: 6100, count: 1, suppliers: ["Guangzhou Sports Co."] },
      { key: "later", total: 4400, count: 1, suppliers: ["Dar Al-Kitab"] },
    ]);
  });

  it("shows what an open dispute holds back on its bill", () => {
    const dak = v.bills.find((b) => b.supplierId === "s-dak")!;
    expect(dak).toMatchObject({ total: 7626, paid: 2980, held: 246, heldOpen: true, heldUnits: 6, siteName: "Benghazi" });
  });

  it("names the goods on the bill and what the supplier is owed in all", () => {
    const nour = v.bills[0];
    expect(nour.items).toEqual([{ name: "Tadabbur", qty: 300 }]);
    expect(nour.supplierName).toBe("Imprimerie Al-Nour");
    expect(nour.supplierOwed).toBe(4200);
  });

  it("counts settled arrivals without an invoice apart — never as zero", () => {
    expect(v.unknownBills).toBe(1);
    expect(v.bills.some((b) => b.receptionId === "r-21")).toBe(false);
  });

  it("files a bill with no due date under « plus tard »", () => {
    const w = buildPurchasesView(input({ receptions: [rec({ id: "r-x", reference: "R", supplierId: "s-nour", invoiceTotal: 100 })] }));
    expect(w.bills[0]).toMatchObject({ bucket: "later", daysLeft: null, daysLate: null });
  });
});

describe("À solder — arrivals counted at the dock, not priced yet", () => {
  const v = buildPurchasesView(input());

  it("lists open groups that received something, and only their counted lines", () => {
    expect(v.arrivals.map((a) => a.receptionId)).toEqual(["r-open"]);
    expect(v.arrivals[0].lines.map((l) => l.id)).toEqual(["lo-1", "lo-2", "lo-3"]);
    expect(v.tiles.toSettle).toBe(1);
  });

  it("pre-fills each price: what the office typed, else the order's price, else the last price paid", () => {
    const [mem, tad, nouveau] = v.arrivals[0].lines;
    expect(mem).toMatchObject({ price: 48, hint: { kind: "po", value: 48 } });
    expect(tad).toMatchObject({ price: 62, hint: { kind: "last", value: 62 }, variant: "Grand", damaged: 2 });
    expect(nouveau).toMatchObject({ price: 7.5, hint: { kind: "current", value: 7.5 } });
  });

  it("guesses the supplier from the order the dock attached, and names the orders", () => {
    expect(v.arrivals[0]).toMatchObject({ supplierId: "s-nour", poRefs: ["BC-LY-2026-0011"], siteName: "Tripoli", countedBy: "Adel", feeBasis: "units" });
  });

  it("splits the fees already typed into transport, customs and the rest", () => {
    expect(v.arrivals[0].fees).toEqual({ freight: 180, customs: 0, other: 15 });
    expect(v.arrivals[0].units).toBe(215);
  });
});

describe("En commande — open purchase orders", () => {
  const v = buildPurchasesView(input());

  it("shows open orders only, the late first", () => {
    expect(v.orders.map((o) => o.ref)).toEqual(["BC-LY-2026-0009", "BC-LY-2026-0011", "BC-LY-2026-0015", "BC-LY-2026-0030"]);
  });

  it("gives each order a state from what arrived and when it is wanted", () => {
    const st = Object.fromEntries(v.orders.map((o) => [o.ref, o.state]));
    expect(st).toEqual({
      "BC-LY-2026-0009": "late",
      "BC-LY-2026-0011": "week",
      "BC-LY-2026-0015": "partial",
      "BC-LY-2026-0030": "waiting",
    });
    expect(v.orders.find((o) => o.ref === "BC-LY-2026-0009")!.daysLate).toBe(4);
  });

  it("carries ordered / received units and the committed total (null when a line has no price)", () => {
    const dak = v.orders.find((o) => o.ref === "BC-LY-2026-0015")!;
    expect(dak).toMatchObject({ ordered: 300, received: 186, total: 12300, siteName: "Benghazi", supplierName: "Dar Al-Kitab", firstReceivedAt: "2026-09-28T08:00:00Z" });
    expect(v.orders.find((o) => o.ref === "BC-LY-2026-0009")!.total).toBeNull();
    expect(v.committed).toBe(9600 + 12300 + 5700);
  });

  it("counts what is wanted this week", () => {
    expect(v.tiles.openOrders).toBe(4);
    expect(v.tiles.arrivingThisWeek).toBe(2);
  });

  it("passes on the restock suggestions with their warehouse", () => {
    expect(v.suggestions).toEqual([{ productId: "p-tad", name: "Tadabbur", siteId: "w-bgz", siteName: "Benghazi", qty: 250, value: 15500, days: 17 }]);
  });
});

describe("Fournisseurs — one card each", () => {
  const v = buildPurchasesView(input());

  it("lists active suppliers, the most owed first", () => {
    expect(v.suppliers.map((s) => s.id)).toEqual(["s-gz", "s-dak", "s-nour"]);
    expect(v.tiles.suppliers).toBe(3);
  });

  it("carries owed, late, open orders and the reliability measured on closed orders", () => {
    const nour = v.suppliers.find((s) => s.id === "s-nour")!;
    expect(nour).toMatchObject({ owed: 4200, overdue: 4200, openOrders: 1, fillRate: 96, sampleOrders: 1, leadTimeDays: 6, toSettle: 1 });
    expect(v.suppliers.find((s) => s.id === "s-gz")!.fillRate).toBeNull();
  });

  it("lists each open claim with the bill it holds back", () => {
    expect(v.suppliers.find((s) => s.id === "s-dak")!.claims).toEqual([
      { id: "cl-1", amount: 246, units: 6, kind: "damaged", receptionRef: "REC-LY-2026-0034" },
    ]);
    expect(v.tiles.openClaims).toBe(1);
  });
});

describe("the order form's catalogue", () => {
  it("knows each product's last price and who sold it", () => {
    const v = buildPurchasesView(input());
    expect(v.catalogue).toEqual([
      { id: "p-mem", name: "Mémoriser facilement", lastPrice: 48, lastSupplierId: "s-nour" },
      { id: "p-sac", name: "Sac de frappe", lastPrice: 95, lastSupplierId: "s-gz" },
      { id: "p-tad", name: "Tadabbur", lastPrice: 62, lastSupplierId: "s-nour" },
    ]);
  });
});
