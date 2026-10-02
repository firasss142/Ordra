import { describe, it, expect } from "vitest";
import { buildSuggestions, queryIntent } from "../suggestions";
import type { MarketSearchRow } from "../market";
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

const marketRow = (over: Partial<MarketSearchRow>): MarketSearchRow => ({
  id: "m1",
  external_id: "49874",
  status: "out_for_delivery",
  customer_name: "Mahmoud Senoussi",
  customer_phone: "+218913565775",
  customer_phone_2: null,
  customer_city: "Benghazi",
  customer_address: null,
  product_name: "Coran",
  variant_label: null,
  total_price: 202,
  currency: "LYD",
  tracking_number: null,
  created_at: "2026-09-22T09:18:00Z",
  archived: false,
  owner: "other",
  owner_name: "Salem",
  access: "view",
  ...over,
});

describe("buildSuggestions — the whole market", () => {
  it("puts a colleague's order in its own read-only group, after the agent's own", () => {
    const groups = buildSuggestions("mahmoud", {
      orders: [order({})],
      parcels: [],
      leads: [],
      market: [marketRow({})],
    });
    expect(groups.map((g) => g.key)).toEqual(["orders", "market"]);
    expect(groups[1].rows[0]).toMatchObject({
      id: "m1",
      view: true,
      owner: "other",
      ownerName: "Salem",
      ref: "49874",
    });
  });

  it("never lists the same order twice when the server returns one the shell already had", () => {
    const groups = buildSuggestions("mahmoud", {
      orders: [order({ id: "o1" })],
      parcels: [],
      leads: [],
      market: [marketRow({ id: "o1", owner: "me", owner_name: null, access: "full" })],
    });
    expect(groups.flatMap((g) => g.rows).filter((r) => r.id === "o1")).toHaveLength(1);
  });

  it("an own order the shell had not loaded joins the agent's orders and opens the usual panel", () => {
    const groups = buildSuggestions("mahmoud", {
      orders: [],
      parcels: [],
      leads: [],
      market: [marketRow({ id: "x9", owner: "me", owner_name: null, access: "full", status: "delivered" })],
      locale: "ar",
    });
    expect(groups[0].key).toBe("orders");
    expect(groups[0].rows[0]).toMatchObject({ id: "x9", href: "/ar/queue?openOrderId=x9" });
    expect(groups[0].rows[0].view).toBeFalsy();
  });

  it("an own order already listed under delivery is not repeated under orders", () => {
    const groups = buildSuggestions("mahmoud", {
      orders: [],
      parcels: [
        { order_id: "p1", customer_name: "Mahmoud F", customer_city: null, customer_phone: null, external_id: null, total_price: 1, bucket: null },
      ],
      leads: [],
      market: [marketRow({ id: "p1", owner: "me", owner_name: null, access: "full" })],
    });
    expect(groups.map((g) => g.key)).toEqual(["delivery"]);
  });

  it("keeps the server's ranking and trusts its match — the server read every format", () => {
    // "+218 91 356 5775" is not a substring of anything the local matcher sees,
    // but the server reduced it to national digits and found these.
    const groups = buildSuggestions("+218 91 356 5775", {
      orders: [],
      parcels: [],
      leads: [],
      market: [marketRow({ id: "a" }), marketRow({ id: "b", owner: "none", owner_name: null })],
    });
    expect(groups[0].rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(groups[0].rows[1]).toMatchObject({ owner: "none" });
  });

  it("counts what the server found beyond the rows it sent, minus the agent's own", () => {
    const groups = buildSuggestions("mahmoud", {
      orders: [],
      parcels: [],
      leads: [],
      market: [marketRow({ id: "mine", owner: "me", owner_name: null, access: "full" }), marketRow({ id: "v1" })],
      marketTotal: 23,
    });
    expect(groups.find((g) => g.key === "market")!.total).toBe(22);
  });

  it("shows on the row why it matched when the hit was in the address or the tracking number", () => {
    const byAddress = buildSuggestions("احمد", {
      orders: [],
      parcels: [],
      leads: [],
      market: [marketRow({ customer_name: "فاطمة المصراتي", customer_address: "قصر أحمد" })],
    });
    expect(byAddress[0].rows[0].subtitle).toContain("قصر أحمد");

    const byTracking = buildSuggestions("DRB-7741", {
      orders: [],
      parcels: [],
      leads: [],
      market: [marketRow({ tracking_number: "DRB-7741203" })],
    });
    expect(byTracking[0].rows[0].subtitle).toContain("DRB-7741203");
  });
});

describe("queryIntent", () => {
  it("reads digits, even typed with spaces, as a phone or a number", () => {
    expect(queryIntent("091 345 67")).toEqual({ kind: "number" });
    expect(queryIntent("+218 91-345-6721")).toEqual({ kind: "number" });
  });

  it("names the field a prefix aims at", () => {
    expect(queryIntent("ville:sfax")).toEqual({ kind: "field", field: "city" });
    expect(queryIntent("tel:0913")).toEqual({ kind: "field", field: "phone" });
  });

  it("anything else is a name, city, product or address", () => {
    expect(queryIntent("احمد")).toEqual({ kind: "text" });
    expect(queryIntent("DRB-7741")).toEqual({ kind: "text" });
  });

  it("says nothing for an empty box", () => {
    expect(queryIntent("  ")).toBeNull();
  });
});
