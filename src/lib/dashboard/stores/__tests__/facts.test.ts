import { describe, expect, it } from "vitest";
import { bkAt, normalizeStoreOrders } from "../facts";

const TZ = "Africa/Tripoli"; // UTC+2

const raw = (o: Record<string, unknown>) => ({
  id: "o1",
  created_at: "2026-09-01T08:30:00Z",
  storefront_id: "s1",
  status: "delivered",
  outcome: "delivered",
  outcome_at: "2026-09-04T10:00:00Z",
  uploaded_at: "2026-09-01T12:00:00Z",
  decided_at: null,
  rejection_reason: null,
  rejection_subreason: null,
  total_price: 210,
  delivery_cost: 25,
  return_cost: 0,
  unmapped: false,
  ...o,
});

describe("normalizeStoreOrders", () => {
  it("reads the market-local day and minute, the store, the bucket and its product lines", () => {
    const [o] = normalizeStoreOrders({ orders: [raw({})], lines: [{ order_id: "o1", product_id: "p1" }] }, TZ);
    expect(o).toMatchObject({ id: "o1", day: "2026-09-01", min: 10 * 60 + 30, store: "s1", bk: "d", price: 210, products: ["p1"] });
    expect(o.doneAt).toBe(Date.parse("2026-09-04T10:00:00Z"));
  });

  it("a rejected order is done when it was decided; a never-real sub-reason is junk", () => {
    const [o] = normalizeStoreOrders(
      { orders: [raw({ status: "rejected", outcome: null, outcome_at: null, uploaded_at: null, decided_at: "2026-09-01T09:00:00Z", rejection_subreason: "doublon" })] },
      TZ,
    );
    expect(o.bk).toBe("j");
    expect(o.doneAt).toBe(Date.parse("2026-09-01T09:00:00Z"));
  });
});

describe("bkAt — where an order stood at a past moment", () => {
  const [o] = normalizeStoreOrders({ orders: [raw({})] }, TZ);

  it("is its result once reached", () => {
    expect(bkAt(o, Date.parse("2026-09-05T00:00:00Z"))).toBe("d");
  });
  it("is on the road after the upload and before the result", () => {
    expect(bkAt(o, Date.parse("2026-09-02T00:00:00Z"))).toBe("r");
  });
  it("is in calls before the upload", () => {
    expect(bkAt(o, Date.parse("2026-09-01T10:00:00Z"))).toBe("c");
  });
  it("a result with no known moment counts as reached", () => {
    const [x] = normalizeStoreOrders({ orders: [raw({ outcome_at: null })] }, TZ);
    expect(bkAt(x, Date.parse("2026-09-01T09:00:00Z"))).toBe("d");
  });
});
