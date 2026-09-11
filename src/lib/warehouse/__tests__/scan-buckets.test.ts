import { describe, it, expect } from "vitest";
import { bucketize, linesOf, isMixed, type RunMode } from "../scan-buckets";
import type { OrderZone } from "../zone-index";
import type { WarehouseOrderRow } from "../summary";

/**
 * How a scan run is cut into batches.
 *
 * The agent works one physical thing at a time: one sticker roll off the shelf,
 * or one product off the rack. So the run asks which, then hands over parcels
 * that share it. Two rules carry the weight:
 *
 *   1. An order with several DIFFERENT products belongs to no product batch.
 *      Filing it under its first line is how a picker walks away with one item
 *      of a three-item parcel, and the sticker is already on the box.
 *   2. Colour order is Darb's, not ours (DARB_ZONE_ORDER), and unknown is last:
 *      it is the batch that needs a human decision, not the one to start with.
 */

const RED: OrderZone = {
  branchGroup: "TR", colorHex: "#d80a0a", colourFr: "Rouge",
  nameFr: "Tripoli et banlieue", nameAr: "طرابلس وضواحيها", source: "carrier",
};
const GREEN: OrderZone = {
  branchGroup: "BN", colorHex: "#339307", colourFr: "Vert",
  nameFr: "Région orientale", nameAr: "المنطقة الشرقية", source: "carrier",
};
const UNKNOWN: OrderZone = {
  branchGroup: null, colorHex: null, colourFr: null, nameFr: null, nameAr: null, source: "unknown",
};

type Row = WarehouseOrderRow & { zone: OrderZone };

let seq = 0;
function row(over: Partial<Row> = {}): Row {
  seq += 1;
  return {
    id: `o${seq}`,
    customer_name: "محمد علي",
    customer_phone: "+218",
    customer_city: "طرابلس",
    customer_area: null,
    customer_address: null,
    product_id: "p1",
    product_name: "Dumbbell",
    variant_label: null,
    quantity: 1,
    total_price: 249,
    status: "uploaded",
    created_at: "2026-09-01T08:00:00.000Z",
    uploaded_at: "2026-09-01T08:00:00.000Z",
    branch_group: "TR",
    tracking_number: null,
    carrier_sticker_ref: null,
    carrier_status_slug: null,
    has_carrier_ref: true,
    current_stock: 10,
    low_stock_threshold: 2,
    zone: RED,
    ...over,
  };
}

const ly = { mode: "product" as RunMode, market: "ly" as const };

describe("linesOf", () => {
  it("uses the order's own lines when it has them", () => {
    const r = row({
      items: [
        { product_id: "p1", product_name: "Dumbbell", variant_label: "5 kg", quantity: 2, image_url: null },
        { product_id: "p2", product_name: "Corde", variant_label: null, quantity: 1, image_url: null },
      ],
    });
    expect(linesOf(r).map((l) => `${l.product_name}×${l.quantity}`)).toEqual(["Dumbbell×2", "Corde×1"]);
  });

  it("falls back to the denormalised single line when there are no item rows", () => {
    const r = row({ product_name: "Livre", quantity: 3, items: [] });
    expect(linesOf(r)).toEqual([
      { product_id: "p1", product_name: "Livre", variant_label: null, quantity: 3, image_url: null },
    ]);
  });

  it("carries the product picture onto the fallback line", () => {
    const r = row({ items: undefined, product_image_url: "https://img/p1.png" });
    expect(linesOf(r)[0].image_url).toBe("https://img/p1.png");
  });
});

describe("isMixed", () => {
  it("is true only when the parcel holds more than one distinct product", () => {
    expect(isMixed(row({ items: [] }))).toBe(false);
    expect(
      isMixed(
        row({
          items: [
            { product_id: "p1", product_name: "A", variant_label: "S", quantity: 1, image_url: null },
            { product_id: "p1", product_name: "A", variant_label: "M", quantity: 1, image_url: null },
          ],
        }),
      ),
    ).toBe(false);
    expect(
      isMixed(
        row({
          items: [
            { product_id: "p1", product_name: "A", variant_label: null, quantity: 1, image_url: null },
            { product_id: "p2", product_name: "B", variant_label: null, quantity: 1, image_url: null },
          ],
        }),
      ),
    ).toBe(true);
  });
});

describe("bucketize — product mode", () => {
  it("groups by product and puts the biggest batch first", () => {
    const rows = [
      row({ product_id: "p1", product_name: "Dumbbell" }),
      row({ product_id: "p2", product_name: "Corde" }),
      row({ product_id: "p1", product_name: "Dumbbell" }),
    ];
    const buckets = bucketize(rows, ly.mode, ly.market);
    expect(buckets.map((b) => [b.label, b.rows.length])).toEqual([
      ["Dumbbell", 2],
      ["Corde", 1],
    ]);
    expect(buckets[0].kind).toBe("product");
  });

  it("never files a multi-product parcel under one of its products", () => {
    const mixed = row({
      id: "mix",
      product_id: "p1",
      items: [
        { product_id: "p1", product_name: "Dumbbell", variant_label: null, quantity: 1, image_url: null },
        { product_id: "p2", product_name: "Corde", variant_label: null, quantity: 1, image_url: null },
      ],
    });
    const buckets = bucketize([row({ product_id: "p1" }), mixed], ly.mode, ly.market);
    const dumbbell = buckets.find((b) => b.kind === "product");
    expect(dumbbell?.rows.map((r) => r.id)).not.toContain("mix");
    const mixedBucket = buckets.find((b) => b.kind === "mixed");
    expect(mixedBucket?.rows.map((r) => r.id)).toEqual(["mix"]);
  });

  it("keeps mixed parcels last even when they are the largest batch", () => {
    const mix = () =>
      row({
        items: [
          { product_id: "p1", product_name: "A", variant_label: null, quantity: 1, image_url: null },
          { product_id: "p2", product_name: "B", variant_label: null, quantity: 1, image_url: null },
        ],
      });
    const buckets = bucketize([mix(), mix(), mix(), row({ product_id: "p9", product_name: "Seul" })], ly.mode, ly.market);
    expect(buckets.map((b) => b.kind)).toEqual(["product", "mixed"]);
  });

  it("groups products with no id by name rather than merging them", () => {
    const buckets = bucketize(
      [row({ product_id: null, product_name: "Sans code" }), row({ product_id: null, product_name: "Autre" })],
      ly.mode,
      ly.market,
    );
    expect(buckets).toHaveLength(2);
  });

  it("carries a picture and the unit count so the picker can find the rack", () => {
    const buckets = bucketize(
      [row({ product_id: "p1", quantity: 2, product_image_url: "https://img/p1.png" }), row({ product_id: "p1", quantity: 3 })],
      ly.mode,
      ly.market,
    );
    expect(buckets[0].imageUrl).toBe("https://img/p1.png");
    expect(buckets[0].units).toBe(5);
  });
});

describe("bucketize — zone mode in Libya", () => {
  it("follows Darb's own roll order, not the parcel counts", () => {
    const buckets = bucketize(
      [row({ zone: GREEN }), row({ zone: GREEN }), row({ zone: RED })],
      "zone",
      "ly",
    );
    expect(buckets.map((b) => b.hex)).toEqual(["#d80a0a", "#339307"]);
  });

  it("puts the colour nobody could resolve last, and marks it", () => {
    const buckets = bucketize([row({ zone: UNKNOWN }), row({ zone: GREEN })], "zone", "ly");
    expect(buckets.map((b) => b.kind)).toEqual(["zone", "zone_unknown"]);
    expect(buckets[1].hex).toBeNull();
  });

  it("names the colour and its region, and keeps the branch code for the plate", () => {
    const [red] = bucketize([row({ zone: RED })], "zone", "ly");
    expect(red.label).toBe("Rouge");
    expect(red.sublabel).toBe("Tripoli et banlieue");
    expect(red.branchGroup).toBe("TR");
  });

  it("labels in Arabic for the Libyan bench", () => {
    const [red] = bucketize([row({ zone: RED })], "zone", "ly", "ar");
    expect(red.sublabel).toBe("طرابلس وضواحيها");
  });
});

describe("bucketize — zone mode in Tunisia", () => {
  it("batches by governorate rather than by raw city", () => {
    const buckets = bucketize(
      [
        row({ customer_city: "La Marsa", zone: UNKNOWN }),
        row({ customer_city: "Ariana", zone: UNKNOWN }),
        row({ customer_city: "Sousse", zone: UNKNOWN }),
      ],
      "zone",
      "tn",
    );
    expect(buckets.map((b) => b.label)).toContain("Tunis");
    // A governorate is a batch, not a roll: no hue, no branch plate.
    expect(buckets.every((b) => b.hex === null && b.branchGroup === null)).toBe(true);
  });

  it("keeps the cities it cannot place in a last bucket of their own", () => {
    const buckets = bucketize(
      [row({ customer_city: null, zone: UNKNOWN }), row({ customer_city: "Sousse", zone: UNKNOWN })],
      "zone",
      "tn",
    );
    expect(buckets[buckets.length - 1].kind).toBe("zone_unknown");
  });
});

describe("bucketize — order within a batch", () => {
  it("hands over the parcel that has waited on the bench longest first", () => {
    const old = row({ id: "old", uploaded_at: "2026-09-01T06:00:00.000Z" });
    const fresh = row({ id: "fresh", uploaded_at: "2026-09-03T06:00:00.000Z" });
    const [bucket] = bucketize([fresh, old], "product", "ly");
    expect(bucket.rows.map((r) => r.id)).toEqual(["old", "fresh"]);
  });

  it("measures the wait from the bench, not from intake", () => {
    const a = row({ id: "a", created_at: "2026-01-01T00:00:00.000Z", uploaded_at: "2026-09-05T00:00:00.000Z" });
    const b = row({ id: "b", created_at: "2026-09-04T00:00:00.000Z", uploaded_at: "2026-09-02T00:00:00.000Z" });
    const [bucket] = bucketize([a, b], "product", "ly");
    expect(bucket.rows.map((r) => r.id)).toEqual(["b", "a"]);
  });

  it("reports the oldest wait on the bucket so the picker can choose", () => {
    const [bucket] = bucketize(
      [row({ uploaded_at: "2026-09-01T00:00:00.000Z" }), row({ uploaded_at: "2026-09-03T00:00:00.000Z" })],
      "product",
      "ly",
    );
    expect(bucket.oldestAt).toBe("2026-09-01T00:00:00.000Z");
  });

  it("returns nothing at all for an empty bench", () => {
    expect(bucketize([], "product", "ly")).toEqual([]);
  });
});
