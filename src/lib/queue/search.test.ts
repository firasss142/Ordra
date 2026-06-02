import { describe, it, expect } from "vitest";
import {
  parseQuery,
  normalize,
  digitsOnly,
  matchesOrder,
  searchOrders,
} from "./search";
import type { QueueOrder } from "@/types/queue";

function makeOrder(overrides: Partial<QueueOrder> = {}): QueueOrder {
  const order: QueueOrder = {
    id: "o1",
    status: "pending",
    customer_name: "",
    customer_phone: "",
    customer_address: null,
    customer_city: "",
    product_name: "",
    variant_label: "",
    quantity: 1,
    product_image_url: null,
    carrier_code: null,
    carrier_name: null,
    total_price: 0,
    currency: "TND",
    market_id: "00000000-0000-0000-0000-000000000001",
    attempt_count: 0,
    callback_time: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    customer_note: null,
    customer_phone_2: null,
    created_at: "2026-01-01T00:00:00Z",
    assigned_at: "2026-01-01T00:00:00Z",
    repeat_kind: "none",
    prior_order_count: 0,
    prior_lead_count: 0,
    prior_rejected_count: 0,
    last_known_address: null,
    rejection_reason: null,
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
    ...overrides,
  };
  order.product_image_url = overrides.product_image_url ?? order.product_image_url;
  return order;
}

describe("normalize", () => {
  it("lowercases, strips accents, and collapses whitespace", () => {
    expect(normalize("  Béja   Nord ")).toBe("beja nord");
    expect(normalize("CRÈME")).toBe("creme");
  });

  it("strips Arabic diacritics (tashkeel)", () => {
    // "مُحَمَّد" with harakat -> bare letters
    expect(normalize("مُحَمَّد")).toBe(normalize("محمد"));
  });

  it("returns empty string for nullish-ish input", () => {
    expect(normalize("")).toBe("");
    expect(normalize("   ")).toBe("");
  });
});

describe("digitsOnly", () => {
  it("keeps digits and drops spaces, plus, dashes", () => {
    expect(digitsOnly("+216 98-12 34")).toBe("21698​1234".replace(/[^0-9]/g, ""));
    expect(digitsOnly("(00216) 55.12.34")).toBe("002165512​34".replace(/[^0-9]/g, ""));
  });

  it("returns empty for non-numeric input", () => {
    expect(digitsOnly("abc")).toBe("");
  });
});

describe("parseQuery", () => {
  it("splits free text into normalized terms", () => {
    const q = parseQuery("Béja  Nord");
    expect(q.field).toBeNull();
    expect(q.terms).toEqual(["beja", "nord"]);
    expect(q.raw).toBe("Béja  Nord");
  });

  it("recognizes a field prefix and scopes terms to that field", () => {
    const q = parseQuery("city:tunis");
    expect(q.field).toBe("city");
    expect(q.terms).toEqual(["tunis"]);
  });

  it("recognizes phone prefix and preserves the remainder for digit matching", () => {
    const q = parseQuery("phone:+216 98");
    expect(q.field).toBe("phone");
  });

  it("treats an unknown prefix as plain text", () => {
    const q = parseQuery("foo:bar");
    expect(q.field).toBeNull();
    expect(q.terms).toEqual(["foo:bar"]);
  });

  it("returns empty terms for blank input", () => {
    expect(parseQuery("   ").terms).toEqual([]);
  });
});

describe("matchesOrder", () => {
  it("matches a customer name accent-insensitively", () => {
    const o = makeOrder({ customer_name: "Béja Trabelsi" });
    expect(matchesOrder(o, parseQuery("beja"))).toBe(true);
  });

  it("requires ALL terms to match (AND across fields)", () => {
    const o = makeOrder({ customer_name: "Ali", customer_city: "Tunis" });
    expect(matchesOrder(o, parseQuery("ali tunis"))).toBe(true);
    expect(matchesOrder(o, parseQuery("ali sfax"))).toBe(false);
  });

  it("matches phone ignoring spaces, plus, and dashes", () => {
    const o = makeOrder({ customer_phone: "+216 98 12 34 56" });
    expect(matchesOrder(o, parseQuery("98123"))).toBe(true);
    expect(matchesOrder(o, parseQuery("21698"))).toBe(true);
  });

  it("matches the secondary phone too", () => {
    const o = makeOrder({ customer_phone_2: "55667788" });
    expect(matchesOrder(o, parseQuery("5566"))).toBe(true);
  });

  it("scopes to one field when a prefix is used", () => {
    const o = makeOrder({ customer_name: "Tunis Ben Ali", customer_city: "Sfax" });
    expect(matchesOrder(o, parseQuery("city:tunis"))).toBe(false);
    expect(matchesOrder(o, parseQuery("name:tunis"))).toBe(true);
  });

  it("matches product and note fields", () => {
    const o = makeOrder({ product_name: "Sérum Vitamine C", customer_note: "rappeler demain" });
    expect(matchesOrder(o, parseQuery("serum"))).toBe(true);
    expect(matchesOrder(o, parseQuery("note:demain"))).toBe(true);
  });
});

describe("searchOrders", () => {
  const orders = [
    makeOrder({ id: "a", customer_name: "Ali", customer_city: "Tunis" }),
    makeOrder({ id: "b", customer_name: "Béja Femme", customer_city: "Béja" }),
    makeOrder({ id: "c", customer_phone: "+216 55 12 34 56" }),
  ];

  it("returns the input unchanged for a blank query", () => {
    expect(searchOrders(orders, "")).toBe(orders);
    expect(searchOrders(orders, "   ")).toBe(orders);
  });

  it("filters to matching orders only", () => {
    expect(searchOrders(orders, "beja").map((o) => o.id)).toEqual(["b"]);
    expect(searchOrders(orders, "5512").map((o) => o.id)).toEqual(["c"]);
  });

  it("returns empty array when nothing matches", () => {
    expect(searchOrders(orders, "zzzz")).toEqual([]);
  });
});
