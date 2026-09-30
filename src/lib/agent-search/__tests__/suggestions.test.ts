import { describe, it, expect } from "vitest";
import { buildSuggestions } from "../suggestions";
import type { QueueOrder } from "@/types/queue";

const order = (over: Partial<QueueOrder>): QueueOrder =>
  ({
    id: "o1",
    customer_name: "Mahmoud Senoussi",
    customer_phone: "091 356 5775",
    customer_address: null,
    customer_city: "Benghazi",
    product_name: "Coran",
    product_display_name: null,
    variant_label: "",
    quantity: 1,
    product_image_url: null,
    carrier_id: null,
    carrier_code: null,
    carrier_name: null,
    total_price: 249,
    currency: "LYD",
    market_id: "m1",
    attempt_count: 0,
    callback_time: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    customer_note: null,
    customer_phone_2: null,
    status: "pending",
    created_at: "2026-09-18T08:00:00Z",
    assigned_at: "2026-09-18T08:00:00Z",
    last_action_at: null,
    repeat_kind: "none",
    prior_order_count: 0,
    prior_lead_count: 0,
    prior_rejected_count: 0,
    last_known_address: null,
    rejection_reason: null,
    rejection_subreason: null,
    rejection_note: null,
    is_potential_duplicate: false,
    duplicate_count: 0,
    duplicate_siblings: [],
    has_uploaded_sibling: false,
    is_duplicate_anchor: false,
    tracking_number: null,
    carrier_barcode_deleted_at: null,
    dexpress_status_slug: null,
    dexpress_status_synced_at: null,
    dexpress_status_accepted: null,
    carrier_status_slug: null,
    carrier_status_synced_at: null,
    ...over,
  }) as QueueOrder;

describe("buildSuggestions", () => {
  it("returns nothing for a query shorter than two characters", () => {
    const groups = buildSuggestions("m", { orders: [order({})], parcels: [], leads: [] });
    expect(groups).toEqual([]);
  });

  it("finds orders by customer name", () => {
    const groups = buildSuggestions("mahmoud", { orders: [order({})], parcels: [], leads: [] });
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("orders");
    expect(groups[0].rows[0].title).toBe("Mahmoud Senoussi");
  });

  it("finds orders by phone digits regardless of formatting", () => {
    const groups = buildSuggestions("0913565775", { orders: [order({})], parcels: [], leads: [] });
    expect(groups[0]?.rows).toHaveLength(1);
  });

  it("groups results by tab, orders first, then delivery, then leads", () => {
    const groups = buildSuggestions("mahmoud", {
      orders: [order({})],
      parcels: [
        {
          order_id: "p1",
          customer_name: "Mahmoud Fitouri",
          customer_city: "Syrte",
          customer_phone: "091 900 4471",
          external_id: "1972218",
          total_price: 199,
          bucket: "act_now",
        },
      ],
      leads: [
        { id: "l1", customer_name: "Mahmoud Ajili", customer_city: "Tripoli", customer_phone: "091 356 4402", status: "attempt_2" },
      ],
    });
    expect(groups.map((g) => g.key)).toEqual(["orders", "delivery", "leads"]);
  });

  it("caps each group so one busy tab cannot bury the others", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      order({ id: `o${i}`, customer_name: `Mahmoud ${i}` }),
    );
    const groups = buildSuggestions("mahmoud", { orders: many, parcels: [], leads: [] });
    expect(groups[0].rows.length).toBeLessThanOrEqual(5);
    expect(groups[0].total).toBe(12);
  });

  it("ranks an exact phone match above a name substring", () => {
    const groups = buildSuggestions("0913565775", {
      orders: [
        order({ id: "name-hit", customer_name: "0913565775 Ltd", customer_phone: "000" }),
        order({ id: "phone-hit", customer_name: "Zed", customer_phone: "091 356 5775" }),
      ],
      parcels: [],
      leads: [],
    });
    expect(groups[0].rows[0].id).toBe("phone-hit");
  });

  it("honours the existing field prefixes", () => {
    const groups = buildSuggestions("city:benghazi", {
      orders: [order({}), order({ id: "o2", customer_city: "Tripoli" })],
      parcels: [],
      leads: [],
    });
    expect(groups[0].rows).toHaveLength(1);
    expect(groups[0].rows[0].id).toBe("o1");
  });

  it("carries the href each suggestion navigates to", () => {
    const groups = buildSuggestions("mahmoud", { orders: [order({})], parcels: [], leads: [] });
    expect(groups[0].rows[0].href).toContain("openOrderId=o1");
  });
});
