import { describe, it, expect } from "vitest";
import { groupRowsByCity, groupRowsByProduct, summarizeScheduled } from "./group";
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
      row({ status: "confirmed", scheduled_at: null }), // ignored
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
