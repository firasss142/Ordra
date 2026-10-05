import { describe, it, expect } from "vitest";
import { enrichReturns } from "../returns-enrich";

/**
 * Rentrer needs two facts the returns RPC does not carry: which building the
 * parcel belongs to, and since when Darb has held it. Both are read beside the
 * RPC and joined here, oldest first — the oldest return is the one to fetch.
 */
describe("enrichReturns", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const rows = [
    { id: "a", created_at: "2026-09-01T00:00:00Z" },
    { id: "b", created_at: "2026-09-20T00:00:00Z" },
    { id: "c", created_at: "2026-09-25T00:00:00Z" },
  ];
  const meta = [
    { id: "a", warehouse_id: "T" },
    { id: "b", warehouse_id: "B" },
    { id: "c", warehouse_id: null },
  ];
  const history = [
    { order_id: "a", created_at: "2026-09-30T12:00:00Z" },
    { order_id: "a", created_at: "2026-09-28T12:00:00Z" },
    { order_id: "b", created_at: "2026-09-04T12:00:00Z" },
  ];

  it("attaches the building and the latest day the parcel reached that status", () => {
    const out = enrichReturns(rows, meta, history, now);
    const a = out.find((r) => r.id === "a")!;
    expect(a.warehouse_id).toBe("T");
    expect(a.returned_at).toBe("2026-09-30T12:00:00Z");
    expect(a.days_at_carrier).toBe(5);
  });

  it("falls back to the order's creation when no transition was recorded", () => {
    const c = enrichReturns(rows, meta, history, now).find((r) => r.id === "c")!;
    expect(c.returned_at).toBeNull();
    expect(c.days_at_carrier).toBe(10);
  });

  it("puts the longest wait first", () => {
    expect(enrichReturns(rows, meta, history, now).map((r) => r.id)).toEqual(["b", "c", "a"]);
  });

  it("keeps only one building when asked", () => {
    expect(enrichReturns(rows, meta, history, now, "B").map((r) => r.id)).toEqual(["b"]);
  });
});
