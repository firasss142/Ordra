import { describe, it, expect } from "vitest";
import {
  bucketOf,
  countCohort,
  confirmationRate,
  deliveryRate,
  isProvisional,
  finalShare,
  stockCover,
  productSignal,
  agentRows,
  rejectionGroups,
  failureCauses,
  groupByProduct,
  dailyCounts,
  type CohortLine,
} from "@/lib/products/cohort";

function line(overrides: Partial<CohortLine> = {}): CohortLine {
  return {
    order_id: "o1",
    product_id: "p1",
    created_at: "2026-09-10T10:00:00Z",
    status: "pending",
    outcome: null,
    outcome_at: null,
    assigned_to: null,
    rejection_reason: null,
    failure_cause: null,
    attempts: 0,
    units: 1,
    share: 1,
    total_price: 249,
    delivery_cost: null,
    return_cost: 0,
    confirmed: false,
    ...overrides,
  };
}

describe("bucketOf — an order that never left", () => {
  it.each([
    ["rejected", "rejected"],
    ["deleted", "deleted"],
    ["cancelled", "cancelled"],
    ["pending", "calling"],
    ["new", "calling"],
    ["assigned", "calling"],
    ["attempt_1", "calling"],
    ["attempt_2", "calling"],
    ["attempt_3", "calling"],
    ["callback_scheduled", "calling"],
    ["confirmed", "to_upload"],
    ["dispatch_scheduled", "to_upload"],
  ])("status %s → %s", (status, bucket) => {
    expect(bucketOf(status, null)).toBe(bucket);
  });
});

describe("bucketOf — an uploaded order reads the shared parcel outcome", () => {
  it.each([
    ["delivered", "delivered"],
    ["failed", "failed"],
    ["in_flight", "in_flight"],
    ["cancelled_before_pickup", "withdrawn"],
  ] as const)("outcome %s → %s", (outcome, bucket) => {
    // The Ordra status no longer decides anything once the parcel has an
    // outcome: a Darb-delivered parcel is still `cancelled` in Ordra today.
    expect(bucketOf("cancelled", outcome)).toBe(bucket);
  });

  it("never lets a post-upload status fall into the calling buckets when the outcome is missing", () => {
    expect(bucketOf("delivered", null)).toBe("delivered");
    expect(bucketOf("returned", null)).toBe("failed");
    expect(bucketOf("to_be_returned", null)).toBe("failed");
    expect(bucketOf("at_carrier", null)).toBe("in_flight");
    expect(bucketOf("out_for_delivery", null)).toBe("in_flight");
  });
});

describe("countCohort", () => {
  const lines = [
    line({ order_id: "a", status: "rejected" }),
    line({ order_id: "b", status: "deleted" }),
    line({ order_id: "c", status: "pending" }),
    line({ order_id: "d", status: "confirmed" }),
    line({ order_id: "e", status: "delivered", outcome: "delivered" }),
    line({ order_id: "f", status: "cancelled", outcome: "failed" }),
    line({ order_id: "g", status: "at_carrier", outcome: "in_flight" }),
    line({ order_id: "h", status: "cancelled", outcome: "cancelled_before_pickup" }),
    line({ order_id: "i", status: "cancelled" }),
  ];

  it("counts every line once, in exactly one bucket", () => {
    const c = countCohort(lines);
    expect(c).toEqual({
      received: 9,
      rejected: 1,
      deleted: 1,
      cancelled: 1,
      calling: 1,
      to_upload: 1,
      uploaded: 4,
      delivered: 1,
      failed: 1,
      in_flight: 1,
      withdrawn: 1,
    });
  });

  it("uploaded is the sum of what became of the parcels", () => {
    const c = countCohort(lines);
    expect(c.uploaded).toBe(c.delivered + c.failed + c.in_flight + c.withdrawn);
  });

  it("is all zeros for no lines", () => {
    expect(countCohort([]).received).toBe(0);
  });
});

describe("rates", () => {
  const c = countCohort([
    ...Array.from({ length: 77 }, (_, i) => line({ order_id: `d${i}`, outcome: "delivered", status: "delivered" })),
    ...Array.from({ length: 63 }, (_, i) => line({ order_id: `f${i}`, outcome: "failed", status: "cancelled" })),
    ...Array.from({ length: 8 }, (_, i) => line({ order_id: `w${i}`, outcome: "in_flight", status: "delivery_delayed" })),
    ...Array.from({ length: 10 }, (_, i) => line({ order_id: `x${i}`, outcome: "cancelled_before_pickup", status: "cancelled" })),
    ...Array.from({ length: 370 }, (_, i) => line({ order_id: `r${i}`, status: "rejected" })),
    ...Array.from({ length: 5 }, (_, i) => line({ order_id: `c${i}`, status: "attempt_1" })),
    line({ order_id: "u", status: "confirmed" }),
  ]);

  it("confirmation = uploaded ÷ (uploaded + rejected), as in Salle de contrôle", () => {
    expect(confirmationRate(c)).toBeCloseTo(158 / (158 + 370), 10);
  });

  it("delivery = delivered ÷ (delivered + failed); parcels still with the carrier do not count", () => {
    expect(deliveryRate(c)).toBeCloseTo(77 / 140, 10);
  });

  it("is provisional above 10 % of uploaded parcels still with the carrier", () => {
    expect(isProvisional(c)).toBe(false); // 8 / 158 = 5 %
    expect(isProvisional({ ...c, in_flight: 16 })).toBe(true); // 16 / 158 = 10.1 %
  });

  it("final share = 1 − (calling + to upload + in flight) ÷ received", () => {
    expect(finalShare(c)).toBeCloseTo(1 - (5 + 1 + 8) / c.received, 10);
  });

  it("returns null rather than dividing by zero", () => {
    const empty = countCohort([]);
    expect(confirmationRate(empty)).toBeNull();
    expect(deliveryRate(empty)).toBeNull();
    expect(finalShare(empty)).toBeNull();
    expect(isProvisional(empty)).toBe(false);
  });
});

describe("stockCover", () => {
  it("is stock ÷ the daily pace of the last 30 days", () => {
    // 158 units left in 30 days → 5.27 a day; 943 in stock → 179 days.
    expect(stockCover(943, 158)).toBeCloseTo(943 / (158 / 30), 10);
  });

  it("is null when nothing left in 30 days (no pace to divide by)", () => {
    expect(stockCover(200, 0)).toBeNull();
  });
});

describe("productSignal", () => {
  const base = { active: true, cover: 120, received: 10, net: 500 };

  it("asks for a restock when the cover is shorter than the supplier lead time", () => {
    expect(productSignal({ ...base, cover: 13.9 }, 14)).toBe("restock");
  });

  it("flags a product with no order in the period", () => {
    expect(productSignal({ ...base, received: 0, net: -80 }, 14)).toBe("nosales");
  });

  it("flags a loss", () => {
    expect(productSignal({ ...base, net: -1 }, 14)).toBe("loss");
  });

  it("says nothing about an inactive product", () => {
    expect(productSignal({ ...base, active: false, cover: 1 }, 14)).toBeNull();
  });

  it("says nothing about a healthy product", () => {
    expect(productSignal(base, 14)).toBeNull();
  });
});

describe("groupByProduct", () => {
  it("puts a mixed order under each of its products (+1 each)", () => {
    const g = groupByProduct([
      line({ order_id: "m", product_id: "p1", share: 0.6 }),
      line({ order_id: "m", product_id: "p2", share: 0.4 }),
      line({ order_id: "s", product_id: "p1" }),
    ]);
    expect(g.get("p1")?.length).toBe(2);
    expect(g.get("p2")?.length).toBe(1);
  });
});

describe("agentRows", () => {
  const rows = agentRows([
    line({ order_id: "1", assigned_to: "tasnim", attempts: 2, status: "delivered", outcome: "delivered" }),
    line({ order_id: "2", assigned_to: "tasnim", attempts: 3, status: "rejected" }),
    line({ order_id: "3", assigned_to: "tasnim", attempts: 1, status: "cancelled", outcome: "failed" }),
    line({ order_id: "4", assigned_to: "tasnim", status: "at_carrier", outcome: "in_flight" }),
    line({ order_id: "5", assigned_to: "salima", status: "pending" }),
    line({ order_id: "6", assigned_to: null, status: "cancelled", outcome: "cancelled_before_pickup" }),
    line({ order_id: "7", assigned_to: null, status: "pending" }),
  ]);

  it("groups by the agent who holds the order, with Salle de contrôle's vocabulary", () => {
    expect(rows.agents[0]).toEqual({
      agent_id: "tasnim",
      assigned: 4,
      attempts: 6,
      uploaded: 3,
      rejected: 1,
      delivered: 1,
      failed: 1,
      in_flight: 1,
    });
  });

  it("orders agents by assigned orders, most first", () => {
    expect(rows.agents.map((a) => a.agent_id)).toEqual(["tasnim", "salima"]);
  });

  it("keeps the unassigned orders apart", () => {
    expect(rows.unassigned).toEqual({ assigned: 2, uploaded: 1 });
  });
});

describe("rejectionGroups", () => {
  it("counts rejected orders by group, largest first, folding retired groups into today's", () => {
    const g = rejectionGroups([
      line({ order_id: "1", status: "rejected", rejection_reason: "commande_invalide" }),
      line({ order_id: "2", status: "rejected", rejection_reason: "doublon" }),
      line({ order_id: "3", status: "rejected", rejection_reason: "injoignable" }),
      line({ order_id: "4", status: "rejected", rejection_reason: null }),
      line({ order_id: "5", status: "delivered", outcome: "delivered", rejection_reason: "autre" }),
    ]);
    expect(g).toEqual([
      { group: "commande_invalide", count: 2 },
      { group: "autre", count: 1 },
      { group: "injoignable", count: 1 },
    ]);
  });
});

describe("failureCauses", () => {
  it("counts failed parcels by the carrier's cause, largest first", () => {
    const f = failureCauses([
      line({ order_id: "1", outcome: "failed", status: "cancelled", failure_cause: "other" }),
      line({ order_id: "2", outcome: "failed", status: "cancelled", failure_cause: "other" }),
      line({ order_id: "3", outcome: "failed", status: "cancelled", failure_cause: "cancelled-by-the-customer" }),
      line({ order_id: "4", outcome: "failed", status: "returned", failure_cause: null }),
      line({ order_id: "5", outcome: "delivered", status: "delivered", failure_cause: "other" }),
    ]);
    expect(f).toEqual([
      { cause: "other", count: 2 },
      { cause: "customer", count: 1 },
      { cause: "unknown", count: 1 },
    ]);
  });

  it("maps every Darb cause slug the API sends", () => {
    const f = failureCauses([
      line({ order_id: "1", outcome: "failed", failure_cause: "3-days-no-response" }),
      line({ order_id: "2", outcome: "failed", failure_cause: "not-needed" }),
    ]);
    expect(f.map((x) => x.cause).sort()).toEqual(["noresp", "notneeded"]);
  });
});

describe("dailyCounts", () => {
  it("fills every market-local day of the window, zeros included", () => {
    const d = dailyCounts(
      ["2026-09-04T22:30:00Z", "2026-09-05T08:00:00Z", "2026-09-06T23:30:00Z"],
      "2026-09-04",
      "2026-09-07",
      "Africa/Tripoli",
    );
    // 22:30 UTC on the 4th is 00:30 on the 5th in Tripoli (UTC+2).
    expect(d).toEqual([0, 2, 0, 1]);
  });
});
