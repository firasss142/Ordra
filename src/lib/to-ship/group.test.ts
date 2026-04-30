import { describe, it, expect } from "vitest";
import {
  applyFilters,
  applySubgroup,
  groupRowsByCarrier,
  groupRowsByCity,
  groupRowsByProduct,
  groupRowsBySchedule,
  groupRowsByStatus,
  groupRowsFlat,
  summarizeScheduled,
} from "./group";
import type { ToShipRow } from "./types";

const base: Omit<ToShipRow, "id" | "customer_city" | "product_id" | "product_name" | "status"> = {
  customer_name: "x",
  quantity: 1,
  total_price: 10,
  variant_label: null,
  current_stock: 100,
  low_stock_threshold: 5,
  scheduled_at: null,
  scheduled_auto: false,
  scheduled_carrier_id: null,
};

function row(overrides: Partial<ToShipRow>): ToShipRow {
  return {
    id: Math.random().toString(36).slice(2),
    customer_city: "Tunis",
    product_id: "p-1",
    product_name: "Tee",
    status: "confirmed",
    ...base,
    ...overrides,
  };
}

describe("groupRowsByCity", () => {
  it("groups rows by customer_city and sorts groups by count desc", () => {
    const rows = [
      row({ customer_city: "Tunis" }),
      row({ customer_city: "Sfax" }),
      row({ customer_city: "Tunis" }),
      row({ customer_city: "Tunis" }),
      row({ customer_city: "Sfax" }),
    ];
    const groups = groupRowsByCity(rows);
    expect(groups.map((g) => g.key)).toEqual(["Tunis", "Sfax"]);
    expect(groups[0].rows).toHaveLength(3);
    expect(groups[1].rows).toHaveLength(2);
  });

  it("buckets rows with null city under 'unknown' label", () => {
    const rows = [row({ customer_city: null }), row({ customer_city: "Tunis" })];
    const groups = groupRowsByCity(rows);
    const unknown = groups.find((g) => g.key === "—");
    expect(unknown).toBeDefined();
    expect(unknown!.rows).toHaveLength(1);
  });
});

describe("groupRowsByProduct", () => {
  it("groups rows by product_id and exposes product_name as label", () => {
    const rows = [
      row({ product_id: "p-1", product_name: "Tee", quantity: 2 }),
      row({ product_id: "p-2", product_name: "Hoodie", quantity: 1 }),
      row({ product_id: "p-1", product_name: "Tee", quantity: 3 }),
    ];
    const groups = groupRowsByProduct(rows);
    const tee = groups.find((g) => g.key === "p-1");
    expect(tee).toBeDefined();
    expect(tee!.label).toBe("Tee");
    expect(tee!.totalQuantity).toBe(5);
    expect(tee!.rows).toHaveLength(2);
  });
});

describe("groupRowsByCarrier", () => {
  it("groups rows by scheduled_carrier_id using a carrier name map", () => {
    const carrierMap = new Map([
      ["c-1", "Aramex"],
      ["c-2", "First Delivery"],
    ]);
    const rows = [
      row({ scheduled_carrier_id: "c-1" }),
      row({ scheduled_carrier_id: "c-2" }),
      row({ scheduled_carrier_id: "c-1" }),
      row({ scheduled_carrier_id: "c-1" }),
    ];
    const groups = groupRowsByCarrier(rows, carrierMap);
    const aramex = groups.find((g) => g.key === "c-1");
    expect(aramex).toBeDefined();
    expect(aramex!.label).toBe("Aramex");
    expect(aramex!.rows).toHaveLength(3);
  });

  it("buckets rows with null carrier under 'unassigned' key, sorted last regardless of size", () => {
    const carrierMap = new Map([["c-1", "Aramex"]]);
    const rows = [
      row({ scheduled_carrier_id: null }),
      row({ scheduled_carrier_id: null }),
      row({ scheduled_carrier_id: null }),
      row({ scheduled_carrier_id: "c-1" }),
    ];
    const groups = groupRowsByCarrier(rows, carrierMap);
    expect(groups[groups.length - 1].key).toBe("__unassigned__");
    expect(groups[groups.length - 1].rows).toHaveLength(3);
  });

  it("falls back to a generic label when carrier id is unknown to the map", () => {
    const groups = groupRowsByCarrier([row({ scheduled_carrier_id: "c-x" })], new Map());
    expect(groups[0].key).toBe("c-x");
    expect(groups[0].label).toMatch(/c-x/);
  });
});

describe("groupRowsBySchedule", () => {
  it("buckets rows into overdue / today / tomorrow / later / unscheduled in fixed order", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const overdue = new Date("2026-04-23T12:00:00Z").toISOString();
    const today = new Date("2026-04-24T18:00:00Z").toISOString();
    const tomorrow = new Date("2026-04-25T09:00:00Z").toISOString();
    const later = new Date("2026-04-28T09:00:00Z").toISOString();

    const rows = [
      row({ status: "dispatch_scheduled", scheduled_at: later }),
      row({ status: "dispatch_scheduled", scheduled_at: today }),
      row({ status: "dispatch_scheduled", scheduled_at: overdue }),
      row({ status: "dispatch_scheduled", scheduled_at: tomorrow }),
      row({ status: "confirmed", scheduled_at: null }),
    ];
    const groups = groupRowsBySchedule(rows, now);
    expect(groups.map((g) => g.key)).toEqual([
      "overdue",
      "today",
      "tomorrow",
      "later",
      "unscheduled",
    ]);
  });

  it("matches summarizeScheduled counts on the same input", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const today = new Date("2026-04-24T18:00:00Z").toISOString();
    const overdue = new Date("2026-04-23T12:00:00Z").toISOString();
    const rows = [
      row({ status: "dispatch_scheduled", scheduled_at: today, scheduled_auto: true }),
      row({ status: "dispatch_scheduled", scheduled_at: today }),
      row({ status: "dispatch_scheduled", scheduled_at: overdue }),
    ];
    const groups = groupRowsBySchedule(rows, now);
    const summary = summarizeScheduled(rows, now);
    const todayGroup = groups.find((g) => g.key === "today");
    const overdueGroup = groups.find((g) => g.key === "overdue");
    expect(todayGroup?.rows.length).toBe(summary.today);
    expect(overdueGroup?.rows.length).toBe(summary.overdue);
  });

  it("omits empty buckets", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const today = new Date("2026-04-24T18:00:00Z").toISOString();
    const rows = [row({ status: "dispatch_scheduled", scheduled_at: today })];
    const groups = groupRowsBySchedule(rows, now);
    expect(groups.map((g) => g.key)).toEqual(["today"]);
  });
});

describe("groupRowsByStatus", () => {
  it("groups rows by status in fixed order: confirmed, dispatch_scheduled, scanned", () => {
    const rows = [
      row({ status: "scanned" }),
      row({ status: "confirmed" }),
      row({ status: "dispatch_scheduled", scheduled_at: "2026-04-25T09:00:00Z" }),
      row({ status: "scanned" }),
      row({ status: "confirmed" }),
    ];
    const groups = groupRowsByStatus(rows);
    expect(groups.map((g) => g.key)).toEqual(["confirmed", "dispatch_scheduled", "scanned"]);
  });
});

describe("groupRowsFlat", () => {
  it("returns a single group containing all rows", () => {
    const rows = [row({}), row({}), row({})];
    const groups = groupRowsFlat(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(3);
  });

  it("returns empty array when given no rows", () => {
    expect(groupRowsFlat([])).toEqual([]);
  });
});

describe("applyFilters", () => {
  it("narrows rows by productId", () => {
    const rows = [
      row({ product_id: "p-1" }),
      row({ product_id: "p-2" }),
      row({ product_id: "p-1" }),
    ];
    const filtered = applyFilters(rows, { productId: "p-1", city: null });
    expect(filtered).toHaveLength(2);
  });

  it("narrows rows by city", () => {
    const rows = [
      row({ customer_city: "Tunis" }),
      row({ customer_city: "Sfax" }),
      row({ customer_city: "Tunis" }),
    ];
    const filtered = applyFilters(rows, { productId: null, city: "Tunis" });
    expect(filtered).toHaveLength(2);
  });

  it("returns all rows when both filters are null", () => {
    const rows = [row({}), row({}), row({})];
    expect(applyFilters(rows, { productId: null, city: null })).toHaveLength(3);
  });

  it("composes filters with AND semantics", () => {
    const rows = [
      row({ product_id: "p-1", customer_city: "Tunis" }),
      row({ product_id: "p-1", customer_city: "Sfax" }),
      row({ product_id: "p-2", customer_city: "Tunis" }),
    ];
    const filtered = applyFilters(rows, { productId: "p-1", city: "Tunis" });
    expect(filtered).toHaveLength(1);
  });
});

describe("applySubgroup", () => {
  it("nests city subgroups inside product groups", () => {
    const rows = [
      row({ product_id: "p-1", product_name: "Tee", customer_city: "Tunis" }),
      row({ product_id: "p-1", product_name: "Tee", customer_city: "Sfax" }),
      row({ product_id: "p-1", product_name: "Tee", customer_city: "Tunis" }),
      row({ product_id: "p-2", product_name: "Hoodie", customer_city: "Tunis" }),
    ];
    const primary = groupRowsByProduct(rows);
    const nested = applySubgroup(primary, "city");
    const tee = nested.find((g) => g.key === "p-1");
    expect(tee?.subgroups).toBeDefined();
    expect(tee!.subgroups!.map((s) => s.key).sort()).toEqual(["Sfax", "Tunis"]);
    const tunis = tee!.subgroups!.find((s) => s.key === "Tunis");
    expect(tunis?.rows).toHaveLength(2);
  });

  it("returns groups untouched when subgrouping is 'none'", () => {
    const rows = [row({ product_id: "p-1" })];
    const primary = groupRowsByProduct(rows);
    const result = applySubgroup(primary, "none");
    expect(result[0].subgroups).toBeUndefined();
  });

  it("preserves parent totalQuantity when nesting", () => {
    const rows = [
      row({ product_id: "p-1", quantity: 2, customer_city: "Tunis" }),
      row({ product_id: "p-1", quantity: 3, customer_city: "Sfax" }),
    ];
    const nested = applySubgroup(groupRowsByProduct(rows), "city");
    expect(nested[0].totalQuantity).toBe(5);
  });
});

describe("summarizeScheduled", () => {
  it("buckets dispatch_scheduled rows into today / tomorrow / later / overdue", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const overdue = new Date("2026-04-23T12:00:00Z").toISOString();
    const today = new Date("2026-04-24T18:00:00Z").toISOString();
    const tomorrow = new Date("2026-04-25T09:00:00Z").toISOString();
    const later = new Date("2026-04-28T09:00:00Z").toISOString();

    const rows = [
      row({ status: "dispatch_scheduled", scheduled_at: overdue }),
      row({ status: "dispatch_scheduled", scheduled_at: today, scheduled_auto: true }),
      row({ status: "dispatch_scheduled", scheduled_at: today }),
      row({ status: "dispatch_scheduled", scheduled_at: tomorrow }),
      row({ status: "dispatch_scheduled", scheduled_at: later }),
      row({ status: "confirmed", scheduled_at: null }),
    ];

    const summary = summarizeScheduled(rows, now);
    expect(summary.overdue).toBe(1);
    expect(summary.today).toBe(2);
    expect(summary.todayAuto).toBe(1);
    expect(summary.tomorrow).toBe(1);
    expect(summary.later).toBe(1);
  });

  it("returns zeroes when no scheduled rows exist", () => {
    const now = new Date("2026-04-24T10:00:00Z");
    const summary = summarizeScheduled([row({ status: "confirmed" })], now);
    expect(summary).toEqual({ overdue: 0, today: 0, todayAuto: 0, tomorrow: 0, later: 0 });
  });
});
