import { describe, it, expect } from "vitest";
import { applyScannedFilters, sortScanned, scannedFacets, EMPTY_SCANNED_FILTER } from "../scanned-filters";
import type { ScannedRow } from "@/app/api/warehouse/scanned/route";
import type { OrderZone } from "../zone-index";

/**
 * Filtering the parcels that already left the bench.
 *
 * The list existed with no filters at all, and the phone and the desk sorted it
 * differently — the same hundred rows read in two orders depending on which
 * device you held. One sort lives here now, and it is not chronological: the
 * reason anyone opens this list is a sticker Darb is not holding.
 */

const RED: OrderZone = {
  branchGroup: "TR", colorHex: "#d80a0a", colourFr: "Rouge",
  nameFr: "Tripoli et banlieue", nameAr: "طرابلس وضواحيها", source: "carrier",
};
const UNKNOWN: OrderZone = {
  branchGroup: null, colorHex: null, colourFr: null, nameFr: null, nameAr: null, source: "unknown",
};

let seq = 0;
function row(over: Partial<ScannedRow> = {}): ScannedRow {
  seq += 1;
  return {
    id: `o${seq}`,
    customer_name: "محمد علي",
    customer_phone: null,
    customer_city: "طرابلس",
    customer_area: null,
    product_id: "p1",
    product_name: "Dumbbell",
    variant_label: null,
    quantity: 1,
    total_price: 100,
    status: "scanned",
    created_at: "2026-09-01T08:00:00.000Z",
    scanned_at: "2026-09-05T08:00:00.000Z",
    scanned_by_name: "Adel",
    tracking_number: null,
    carrier_sticker_ref: "7700001",
    carrier_status_slug: null,
    sticker_bind_state: "confirmed",
    carrier_reference_actual: null,
    branch_group: "TR",
    warehouse_id: null,
    carrier_name: null,
    current_stock: 5,
    low_stock_threshold: 1,
    zone: RED,
    ...over,
  } as ScannedRow;
}

describe("sortScanned", () => {
  it("floats the parcels Darb is not holding our number for", () => {
    const ok = row({ id: "ok", sticker_bind_state: "confirmed", scanned_at: "2026-09-09T10:00:00.000Z" });
    const bad = row({ id: "bad", sticker_bind_state: "not_registered", scanned_at: "2026-09-01T10:00:00.000Z" });
    expect(sortScanned([ok, bad]).map((r) => r.id)).toEqual(["bad", "ok"]);
  });

  it("orders the rest newest first, so the last scan is at the top", () => {
    const older = row({ id: "older", scanned_at: "2026-09-01T10:00:00.000Z" });
    const newer = row({ id: "newer", scanned_at: "2026-09-09T10:00:00.000Z" });
    expect(sortScanned([older, newer]).map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("does not treat an unchecked bind as a problem", () => {
    const unchecked = row({ id: "unchecked", sticker_bind_state: null, scanned_at: "2026-09-01T10:00:00.000Z" });
    const fresh = row({ id: "fresh", sticker_bind_state: "confirmed", scanned_at: "2026-09-09T10:00:00.000Z" });
    expect(sortScanned([unchecked, fresh]).map((r) => r.id)).toEqual(["fresh", "unchecked"]);
  });

  it("leaves the caller's array alone", () => {
    const rows = [row({ id: "a", scanned_at: "2026-09-01T10:00:00.000Z" }), row({ id: "b", scanned_at: "2026-09-09T10:00:00.000Z" })];
    sortScanned(rows);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

describe("applyScannedFilters", () => {
  const rows = [
    row({ id: "waiting", status: "scanned", sticker_bind_state: "confirmed" }),
    row({ id: "handed", status: "at_carrier", sticker_bind_state: "confirmed" }),
    row({ id: "check", status: "scanned", sticker_bind_state: "restickered", carrier_reference_actual: "1279049" }),
  ];

  it("shows everything by default", () => {
    expect(applyScannedFilters(rows, EMPTY_SCANNED_FILTER)).toHaveLength(3);
  });

  it("narrows to the parcels that need a human", () => {
    const out = applyScannedFilters(rows, { ...EMPTY_SCANNED_FILTER, seg: "check" });
    expect(out.map((r) => r.id)).toEqual(["check"]);
  });

  it("separates what is still on the bench from what the carrier took", () => {
    expect(applyScannedFilters(rows, { ...EMPTY_SCANNED_FILTER, seg: "waiting" }).map((r) => r.id)).toEqual([
      "waiting",
      "check",
    ]);
    expect(applyScannedFilters(rows, { ...EMPTY_SCANNED_FILTER, seg: "handed" }).map((r) => r.id)).toEqual(["handed"]);
  });

  it("filters by sticker roll, and by the roll nobody could resolve", () => {
    const green = row({ id: "green", zone: { ...RED, colorHex: "#339307" } });
    const unknown = row({ id: "unknown", zone: UNKNOWN });
    const all = [...rows, green, unknown];
    expect(applyScannedFilters(all, { ...EMPTY_SCANNED_FILTER, hex: "#339307" }).map((r) => r.id)).toEqual(["green"]);
    expect(applyScannedFilters(all, { ...EMPTY_SCANNED_FILTER, hex: "unknown" }).map((r) => r.id)).toEqual(["unknown"]);
  });

  it("finds a parcel by the number printed on the box", () => {
    const target = row({ id: "target", carrier_sticker_ref: "7712345" });
    const out = applyScannedFilters([...rows, target], { ...EMPTY_SCANNED_FILTER, q: "7712345" });
    expect(out.map((r) => r.id)).toEqual(["target"]);
  });

  it("finds a parcel by the number DARB is holding instead of ours", () => {
    const out = applyScannedFilters(rows, { ...EMPTY_SCANNED_FILTER, q: "1279049" });
    expect(out.map((r) => r.id)).toEqual(["check"]);
  });

  it("searches the customer and the product too, ignoring case and spaces", () => {
    const target = row({ id: "target", customer_name: "Sarah Ben Ali", product_name: "Corde" });
    const all = [...rows, target];
    expect(applyScannedFilters(all, { ...EMPTY_SCANNED_FILTER, q: "  sarah " }).map((r) => r.id)).toEqual(["target"]);
    expect(applyScannedFilters(all, { ...EMPTY_SCANNED_FILTER, q: "corde" }).map((r) => r.id)).toEqual(["target"]);
  });

  it("filters by product and by who scanned it", () => {
    const other = row({ id: "other", product_name: "Corde", scanned_by_name: "Nour" });
    const all = [...rows, other];
    expect(applyScannedFilters(all, { ...EMPTY_SCANNED_FILTER, product: "Corde" }).map((r) => r.id)).toEqual(["other"]);
    expect(applyScannedFilters(all, { ...EMPTY_SCANNED_FILTER, who: "Nour" }).map((r) => r.id)).toEqual(["other"]);
  });

  it("combines filters rather than replacing them", () => {
    const all = [...rows, row({ id: "greenCheck", sticker_bind_state: "not_registered", zone: { ...RED, colorHex: "#339307" } })];
    const out = applyScannedFilters(all, { ...EMPTY_SCANNED_FILTER, seg: "check", hex: "#339307" });
    expect(out.map((r) => r.id)).toEqual(["greenCheck"]);
  });
});

describe("scannedFacets", () => {
  it("counts each segment so a tab can show what it holds", () => {
    const f = scannedFacets([
      row({ status: "scanned", sticker_bind_state: "confirmed" }),
      row({ status: "at_carrier", sticker_bind_state: "confirmed" }),
      row({ status: "scanned", sticker_bind_state: "not_registered" }),
    ]);
    expect(f.segments).toEqual({ all: 3, check: 1, waiting: 2, handed: 1 });
  });

  it("lists the rolls, the products and the scanners actually present", () => {
    const f = scannedFacets([
      row({ product_name: "Dumbbell", scanned_by_name: "Adel" }),
      row({ product_name: "Corde", scanned_by_name: "Nour", zone: UNKNOWN }),
    ]);
    expect(f.products).toEqual(["Corde", "Dumbbell"]);
    expect(f.scanners).toEqual(["Adel", "Nour"]);
    expect(f.rolls).toEqual({ "#d80a0a": 1 });
    expect(f.unknownRoll).toBe(1);
  });
});
