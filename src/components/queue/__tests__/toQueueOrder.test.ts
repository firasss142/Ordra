import { describe, expect, test } from "vitest";
import { toQueueOrder } from "../QueuePage";

/**
 * toQueueOrder is the only gate between /api/agent/queue and QueueOrder, so a
 * key the server ships but the mapper omits is silently and permanently lost —
 * no crash, no warning, just a field that reads undefined forever.
 *
 * That is how product_display_name went missing: the route flattens
 * products.name onto every row, types/queue.ts declares it, and OrderCard reads
 * `order.product_display_name || order.product_name` — but the mapper never
 * copied it, so the `||` always fell through to the raw storefront string. 77
 * active assigned orders differ, and every manager surface reads the field
 * correctly, so the two roles saw different product names for the same order.
 *
 * The key-coverage test below is the general guard: it fails for the NEXT
 * dropped field too, not just this one.
 */

// One row carrying every field the API actually sends, with values distinct
// enough that a mis-mapping is visible.
const apiRow: Record<string, unknown> = {
  id: "o1",
  status: "attempt_2",
  customer_name: "Amina",
  customer_phone: "0912345678",
  customer_phone_2: "0918888888",
  customer_address: "Rue 1",
  customer_city: "Tripoli",
  customer_note: "call after 6",
  product_name: "SERUM-RAW-SKU",
  product_display_name: "Vitamin C Serum",
  product_image_url: "https://img/1.png",
  variant_label: "30ml",
  quantity: 2,
  total_price: 240,
  currency: "LYD",
  market_id: "m1",
  carrier_id: "c1",
  carrier_code: "darb_assabil",
  carrier_name: "Darb Assabil",
  attempts_count: 2,
  callback_scheduled_at: "2026-08-12T10:00:00Z",
  scheduled_dispatch_at: null,
  scheduled_dispatch_auto: false,
  created_at: "2026-08-01T08:00:00Z",
  last_action_at: "2026-08-10T09:00:00Z",
  repeat_kind: "repeat",
  prior_order_count: 3,
  prior_lead_count: 1,
  prior_rejected_count: 0,
  last_known_address: "Rue 1",
  rejection_reason: null,
  rejection_subreason: null,
  rejection_note: null,
  is_potential_duplicate: true,
  duplicate_count: 1,
  duplicate_siblings: [{ id: "sib" }],
  has_uploaded_sibling: false,
  is_duplicate_anchor: true,
  tracking_number: "SH-1",
  carrier_barcode_deleted_at: null,
  dexpress_status_slug: null,
  dexpress_status_synced_at: null,
  dexpress_status_accepted: null,
  carrier_status_slug: "in_transit",
  carrier_status_synced_at: "2026-08-10T10:00:00Z",
};

describe("toQueueOrder", () => {
  test("carries product_display_name through, so the card can prefer the catalog name", () => {
    expect(toQueueOrder(apiRow).product_display_name).toBe("Vitamin C Serum");
  });

  test("falls back to null when the server did not resolve a catalog name", () => {
    const { product_display_name: _omitted, ...withoutIt } = apiRow;
    expect(toQueueOrder(withoutIt).product_display_name).toBeNull();
  });

  // The general guard: every field the API sends must survive the mapper.
  // `attempts_count` and `callback_scheduled_at` are renamed on purpose
  // (attempt_count / callback_time), so they are checked by their new names.
  test("drops no field the API sends", () => {
    const mapped = toQueueOrder(apiRow) as unknown as Record<string, unknown>;
    const renamed: Record<string, string> = {
      attempts_count: "attempt_count",
      callback_scheduled_at: "callback_time",
    };

    const missing = Object.keys(apiRow).filter((k) => {
      const target = renamed[k] ?? k;
      return !(target in mapped);
    });

    expect(missing).toEqual([]);
  });

  test("preserves the values it maps, not just the keys", () => {
    const mapped = toQueueOrder(apiRow);
    expect(mapped.attempt_count).toBe(2);
    expect(mapped.callback_time).toBe("2026-08-12T10:00:00Z");
    expect(mapped.carrier_code).toBe("darb_assabil");
    expect(mapped.total_price).toBe(240);
    expect(mapped.is_duplicate_anchor).toBe(true);
  });
});
