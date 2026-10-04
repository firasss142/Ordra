import { describe, it, expect } from "vitest";
import {
  bkOf,
  normalizeOrders,
  matchProducts,
  matchAgents,
  GROUP,
} from "@/lib/performance/orders/facts";

describe("bkOf — what became of an order (the cohort buckets of Produits, plus « jamais réelle »)", () => {
  it("reads an uploaded parcel's fate from carrier_parcel_outcome", () => {
    expect(bkOf("delivered", "delivered", null, null)).toBe("d");
    expect(bkOf("returned", "failed", null, null)).toBe("f");
    expect(bkOf("cancelled", "cancelled_before_pickup", null, null)).toBe("b");
    expect(bkOf("in_transit", "in_flight", null, null)).toBe("r");
    // Darb's status wins over Ordra's « cancelled » once the parcel was picked up.
    expect(bkOf("cancelled", "failed", null, null)).toBe("f");
  });
  it("splits rejections into real refusals and orders that were never real", () => {
    expect(bkOf("rejected", null, "refus_client", "changement_avis")).toBe("x");
    expect(bkOf("rejected", null, "commande_invalide", "non_serieux")).toBe("x");
    expect(bkOf("rejected", null, "autre", null)).toBe("x");
    for (const sub of ["non_commande", "simple_info", "numero_hors_service", "doublon", "numero_invalide"]) {
      expect(bkOf("rejected", null, "commande_invalide", sub)).toBe("j");
    }
  });
  it("counts deleted and cancelled-before-upload orders as never real", () => {
    expect(bkOf("deleted", null, null, null)).toBe("s");
    expect(bkOf("cancelled", null, null, null)).toBe("s");
  });
  it("keeps orders still being worked as pending", () => {
    expect(bkOf("attempt_2", null, null, null)).toBe("c");
    expect(bkOf("pending", null, null, null)).toBe("c");
    expect(bkOf("confirmed", null, null, null)).toBe("u");
    expect(GROUP.c).toBe("pend");
    expect(GROUP.r).toBe("pend");
    expect(GROUP.b).toBe("ret");
    expect(GROUP.s).toBe("junk");
  });
});

describe("normalizeOrders", () => {
  it("attaches each order's product lines and its market-local day", () => {
    const out = normalizeOrders(
      {
        orders: [
          {
            id: "o1", ref: "1042", created_at: "2026-10-03T23:30:00Z", status: "delivered", outcome: "delivered",
            failure_cause: null, assigned_to: "a1", rejection_reason: null, rejection_subreason: null,
            total_price: "120.5", city: " طرابلس ",
          },
        ],
        lines: [
          { order_id: "o1", product_id: "p1", share: 0.75, variants: ["v1"] },
          { order_id: "o1", product_id: "p2", share: 0.25, variants: null },
        ],
      },
      "Africa/Tripoli",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: "o1", day: "2026-10-04", bk: "d", agent: "a1", price: 120.5, city: "طرابلس",
      lines: [{ p: "p1", v: ["v1"], share: 0.75 }, { p: "p2", v: [], share: 0.25 }],
    });
  });
  it("survives an empty or malformed payload", () => {
    expect(normalizeOrders(null, "Africa/Tripoli")).toEqual([]);
    expect(normalizeOrders({ orders: "x" }, "Africa/Tripoli")).toEqual([]);
  });
});

describe("filters", () => {
  const o = {
    agent: "a1",
    lines: [
      { p: "p1", v: ["s", "m"], share: 0.5 },
      { p: "p2", v: [], share: 0.5 },
    ],
  };
  it("matches a product group, whole products or chosen sizes", () => {
    expect(matchProducts(o, {})).toBe(true);
    expect(matchProducts(o, { p1: null })).toBe(true);
    expect(matchProducts(o, { p3: null })).toBe(false);
    expect(matchProducts(o, { p1: ["m"] })).toBe(true);
    expect(matchProducts(o, { p1: ["l"] })).toBe(false);
    expect(matchProducts(o, { p3: null, p2: null })).toBe(true);
  });
  it("matches agents; no agent chosen means the whole team", () => {
    expect(matchAgents(o, [])).toBe(true);
    expect(matchAgents(o, ["a1", "a2"])).toBe(true);
    expect(matchAgents(o, ["a2"])).toBe(false);
    expect(matchAgents({ agent: null }, ["a2"])).toBe(false);
  });
});
