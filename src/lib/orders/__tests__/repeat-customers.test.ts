import { describe, it, expect } from "vitest";
import { buildCases, copiesOf, keepOf, type RepeatCustomerRow, type RepeatOrder } from "@/lib/orders/repeat-customers";
import type { DuplicateGroup, DuplicateGroupMember } from "@/lib/duplicate-orders/groups";

let n = 0;
const order = (o: Partial<RepeatOrder> = {}): RepeatOrder => ({
  id: `o${++n}`,
  external_id: null,
  created_at: "2026-10-01T10:00:00Z",
  status: "pending",
  customer_name: "Hiba",
  customer_phone: "0912345678",
  customer_city: "Tripoli",
  customer_address: null,
  product_id: "p1",
  product_name: "Plaid",
  product_image_url: null,
  variant_label: null,
  quantity: 1,
  total_price: 220,
  assigned_to: null,
  storefront_id: null,
  rejection_reason: null,
  rejection_subreason: null,
  callback_scheduled_at: null,
  attempts_count: 0,
  ...o,
});
const member = (o: RepeatOrder, x: Partial<DuplicateGroupMember> = {}): DuplicateGroupMember => ({
  id: o.id,
  external_id: o.external_id,
  status: o.status,
  created_at: o.created_at,
  product_id: o.product_id,
  product_name: o.product_name,
  product_image_url: null,
  quantity: o.quantity,
  unit_price: o.total_price,
  total_price: o.total_price,
  customer_name: o.customer_name,
  customer_address: o.customer_address,
  customer_city: o.customer_city,
  already_shipped: false,
  is_anchor: false,
  deletable: true,
  ...x,
});
const group = (members: DuplicateGroupMember[], x: Partial<DuplicateGroup> = {}): DuplicateGroup => ({
  key: "912345678|p1",
  members,
  confidence: "high",
  address_matches: true,
  city_matches: true,
  span_minutes: 30,
  ...x,
});
const cust = (orders: RepeatOrder[], id = "c1"): RepeatCustomerRow => ({ customer_id: id, last_at: orders[orders.length - 1].created_at, orders });

describe("buildCases — one client at a time", () => {
  it("reads reliability from the past: delivered and nothing lost is Fiable", () => {
    const [c] = buildCases([cust([order({ status: "delivered" }), order({ status: "delivered" }), order({ status: "pending", created_at: "2026-10-04T09:00:00Z" })])], []);
    expect(c.rel).toBe("ok");
    expect(c.delivered).toBe(2);
    expect(c.bad).toBe(0);
  });

  it("two or more lost and more lost than delivered is À risque", () => {
    const [c] = buildCases([cust([order({ status: "rejected" }), order({ status: "returned" }), order({ status: "delivered" }), order()])], []);
    expect(c.rel).toBe("risk");
  });

  it("a mixed past is Moyen", () => {
    const [c] = buildCases([cust([order({ status: "rejected" }), order({ status: "delivered" }), order()])], []);
    expect(c.rel).toBe("mid");
  });

  it("a duplicate group counts once in the client's orders", () => {
    const a = order({ created_at: "2026-10-04T08:00:00Z" });
    const b = order({ created_at: "2026-10-04T08:30:00Z" });
    const [c] = buildCases([cust([a, b])], [group([member(b), member(a)])]);
    expect(c.orders.map((o) => o.id)).toEqual([a.id]);
    expect(c.group).not.toBeNull();
    expect(c.rel).toBe("new");
  });

  it("a duplicate whose client is unknown to the history still gets a case", () => {
    const a = order({ id: "x1" });
    const b = order({ id: "x2", created_at: "2026-10-01T11:00:00Z" });
    const cases = buildCases([], [group([member(a), member(b)])]);
    expect(cases).toHaveLength(1);
    expect(cases[0].phone).toBe("912345678");
    expect(cases[0].rel).toBe("new");
  });

  it("newest client first", () => {
    const old = cust([order({ created_at: "2026-09-01T10:00:00Z" }), order({ created_at: "2026-09-30T10:00:00Z" })], "old");
    const recent = cust([order({ created_at: "2026-09-02T10:00:00Z" }), order({ created_at: "2026-10-04T10:00:00Z" })], "new");
    expect(buildCases([old, recent], []).map((c) => c.key)).toEqual(["new", "old"]);
  });
});

describe("the cleanup — what is kept, what goes", () => {
  it("keeps the first order, or the one already at the carrier", () => {
    const a = order({ created_at: "2026-10-04T08:00:00Z" });
    const b = order({ created_at: "2026-10-04T09:00:00Z", status: "uploaded" });
    const c = order({ created_at: "2026-10-04T10:00:00Z" });
    expect(keepOf(group([member(c), member(a)]), {})).toBe(a.id);
    const g = group([member(c), member(b, { already_shipped: true, deletable: false }), member(a)]);
    expect(keepOf(g, {})).toBe(b.id);
    expect(keepOf(g, { [g.key]: c.id })).toBe(c.id);
  });

  it("a copy to delete is neither the kept one, nor shipped, nor locked", () => {
    const a = order({ created_at: "2026-10-04T08:00:00Z" });
    const b = order({ created_at: "2026-10-04T09:00:00Z" });
    const s = order({ created_at: "2026-10-04T10:00:00Z" });
    const g = group([member(a), member(b), member(s, { already_shipped: true, deletable: false })]);
    expect(copiesOf(g, {}).map((m) => m.id)).toEqual([a.id, b.id].filter((id) => id !== keepOf(g, {})));
  });
});
