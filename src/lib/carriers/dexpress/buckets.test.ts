/**
 * Tests for the fermé-tab bucket function.
 *
 * The bucket function maps an order's (OMS-status, carrier, Dexpress slug)
 * triple to one of 5 list-side buckets:
 *   uploaded · deposit · delivered · returned · rejected
 *
 * It returns null for orders that don't belong in the bucket model — caller
 * falls back to the existing pill.
 *
 * Mapping spec: plans/dexpress-list-status-bucket.md → "The five buckets".
 */

import { describe, test, expect } from "vitest";
import { bucketFor, type BucketInput } from "./buckets";
import type { DexpressSlug } from "./statuses";

function input(overrides: Partial<BucketInput>): BucketInput {
  return {
    status: "uploaded",
    carrierCode: "dexpress",
    dexpressStatusSlug: null,
    dexpressStatusAccepted: null,
    ...overrides,
  };
}

describe("bucketFor — Rejected (OMS-side, carrier-irrelevant)", () => {
  test("status=rejected always returns 'rejected', regardless of slug", () => {
    expect(bucketFor(input({ status: "rejected" }))).toBe("rejected");
    expect(
      bucketFor(input({ status: "rejected", dexpressStatusSlug: "DELIVERED" })),
    ).toBe("rejected");
  });

  test("status=rejected returns 'rejected' even on a non-Dexpress carrier", () => {
    expect(
      bucketFor(input({ status: "rejected", carrierCode: "navex" })),
    ).toBe("rejected");
    expect(
      bucketFor(input({ status: "rejected", carrierCode: null })),
    ).toBe("rejected");
  });
});

describe("bucketFor — Deposit (12 in-flight Dexpress slugs)", () => {
  const DEPOSIT_SLUGS: DexpressSlug[] = [
    "BEING_PREPARED",
    "IN_COMPANY",
    "WILL_BE_SENT_TO_BRANCHES",
    "EN_ROUTE_TO_BRANCHES",
    "ARRIVED_AT_BRANCHES",
    "SENT_TO_COURIER",
    "OUT_FOR_DELIVERY",
    "AT_CUSTOMER",
    "DELIVERY_POSTPONED",
    "POSTPONED_WITH_COURIER",
    "REPLACED",
  ];

  test.each(DEPOSIT_SLUGS)(
    "slug %s on an uploaded Dexpress order → 'deposit'",
    (slug) => {
      expect(
        bucketFor(
          input({
            status: "uploaded",
            carrierCode: "dexpress",
            dexpressStatusSlug: slug,
          }),
        ),
      ).toBe("deposit");
    },
  );

  test("OMS status='dispatched' with no Dexpress slug → 'deposit'", () => {
    expect(
      bucketFor(
        input({
          status: "dispatched",
          carrierCode: "dexpress",
          dexpressStatusSlug: null,
        }),
      ),
    ).toBe("deposit");
  });

  test("OMS status='dispatched' on non-Dexpress carrier → 'deposit'", () => {
    expect(
      bucketFor(
        input({
          status: "dispatched",
          carrierCode: "navex",
          dexpressStatusSlug: null,
        }),
      ),
    ).toBe("deposit");
  });
});

describe("bucketFor — Delivered (3 Dexpress slugs + OMS terminal)", () => {
  const DELIVERED_SLUGS: DexpressSlug[] = [
    "DELIVERED",
    "AWAITING_COURIER_SETTLEMENT",
    "PARTIALLY_DELIVERED",
  ];

  test.each(DELIVERED_SLUGS)(
    "slug %s on an uploaded Dexpress order → 'delivered'",
    (slug) => {
      expect(
        bucketFor(
          input({
            status: "uploaded",
            carrierCode: "dexpress",
            dexpressStatusSlug: slug,
          }),
        ),
      ).toBe("delivered");
    },
  );

  test("OMS status='delivered' (carrier webhook / manager) → 'delivered'", () => {
    expect(bucketFor(input({ status: "delivered" }))).toBe("delivered");
  });

  test("OMS status='delivered' on non-Dexpress carrier → 'delivered'", () => {
    expect(
      bucketFor(input({ status: "delivered", carrierCode: "navex" })),
    ).toBe("delivered");
  });
});

describe("bucketFor — Returned (5 Dexpress slugs + OMS terminal)", () => {
  const RETURNED_SLUGS: DexpressSlug[] = [
    "RECEIPT_REFUSED",
    "RETURNING_VIA_COURIER",
    "RETURNING_AT_BRANCHES",
    "RETURNING_TO_COMPANY",
    "RETURNED_AT_COMPANY",
  ];

  test.each(RETURNED_SLUGS)(
    "slug %s on an uploaded Dexpress order → 'returned'",
    (slug) => {
      expect(
        bucketFor(
          input({
            status: "uploaded",
            carrierCode: "dexpress",
            dexpressStatusSlug: slug,
          }),
        ),
      ).toBe("returned");
    },
  );

  test("OMS status='returned' (terminal) → 'returned'", () => {
    expect(bucketFor(input({ status: "returned" }))).toBe("returned");
  });
});

describe("bucketFor — Uploaded (the fallback bucket)", () => {
  test("status=uploaded, carrier=dexpress, slug=null → 'uploaded' (never synced)", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "dexpress",
          dexpressStatusSlug: null,
        }),
      ),
    ).toBe("uploaded");
  });

  test("status=uploaded, carrier=dexpress, slug=unknown string → 'uploaded' (graceful degradation)", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "dexpress",
          dexpressStatusSlug: "SOME_NEW_DEXPRESS_STATUS_WE_DONT_KNOW_YET",
        }),
      ),
    ).toBe("uploaded");
  });

  test("status=uploaded on a non-Dexpress carrier → 'uploaded' (Navex, Libyan carrier, etc)", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "navex",
          dexpressStatusSlug: null,
        }),
      ),
    ).toBe("uploaded");
  });

  test("status=uploaded, carrier=null → 'uploaded'", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: null,
          dexpressStatusSlug: null,
        }),
      ),
    ).toBe("uploaded");
  });

  test("non-Dexpress carrier with a stale Dexpress slug stuck on the row → still 'uploaded' (slug ignored)", () => {
    // Defensive: if a slug somehow leaked onto a non-Dexpress order, we don't
    // honor it — the bucket model only applies to Dexpress orders.
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "navex",
          dexpressStatusSlug: "DELIVERED",
        }),
      ),
    ).toBe("uploaded");
  });
});

describe("bucketFor — un-accepted (pending-orders) override", () => {
  // When Dexpress hasn't accepted the order yet, the portal returns the same
  // order_status as AT_CUSTOMER (id=1) but with order_accept=0. Probe evidence
  // 2026-05-29: tracking 1345233 and 1345235 (both in /merchant/pending-orders)
  // returned {order_status:"1", order_accept:"0", status_name:"عند العميل"}.
  // The slug alone is ambiguous, so dexpressStatusAccepted=false forces the
  // bucket to 'uploaded'.

  test("slug=AT_CUSTOMER, accepted=false → 'uploaded' (pending acceptance, not real Deposit)", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "dexpress",
          dexpressStatusSlug: "AT_CUSTOMER",
          dexpressStatusAccepted: false,
        }),
      ),
    ).toBe("uploaded");
  });

  test("slug=AT_CUSTOMER, accepted=true → 'deposit' (real at-customer delivery)", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "dexpress",
          dexpressStatusSlug: "AT_CUSTOMER",
          dexpressStatusAccepted: true,
        }),
      ),
    ).toBe("deposit");
  });

  test("accepted=null (never synced or pre-migration row) → falls back to slug behavior", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "dexpress",
          dexpressStatusSlug: "AT_CUSTOMER",
          dexpressStatusAccepted: null,
        }),
      ),
    ).toBe("deposit");
  });

  test("accepted=false overrides EVERY slug, not just AT_CUSTOMER (defensive — if Dexpress reuses other ids for pending state)", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "dexpress",
          dexpressStatusSlug: "BEING_PREPARED",
          dexpressStatusAccepted: false,
        }),
      ),
    ).toBe("uploaded");
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "dexpress",
          dexpressStatusSlug: "OUT_FOR_DELIVERY",
          dexpressStatusAccepted: false,
        }),
      ),
    ).toBe("uploaded");
  });

  test("accepted=false on a non-Dexpress carrier is ignored (model is Dexpress-scoped)", () => {
    // Defensive: a leaked flag on a Navex order shouldn't change behavior.
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "navex",
          dexpressStatusSlug: null,
          dexpressStatusAccepted: false,
        }),
      ),
    ).toBe("uploaded");
  });

  test("accepted=false does NOT override OMS terminal statuses (delivered/returned/rejected stay terminal)", () => {
    expect(
      bucketFor(
        input({
          status: "delivered",
          carrierCode: "dexpress",
          dexpressStatusSlug: "DELIVERED",
          dexpressStatusAccepted: false,
        }),
      ),
    ).toBe("delivered");
    expect(
      bucketFor(
        input({
          status: "rejected",
          carrierCode: "dexpress",
          dexpressStatusSlug: "AT_CUSTOMER",
          dexpressStatusAccepted: false,
        }),
      ),
    ).toBe("rejected");
  });
});

describe("bucketFor — orders that don't belong in fermé", () => {
  // These statuses never appear in the fermé tab (caller filters them out
  // before reaching the bucket function), but we still return null to make
  // the contract explicit: bucketFor only knows how to classify fermé orders.
  const NON_FERME_STATUSES = [
    "pending",
    "assigned",
    "attempt_1",
    "attempt_2",
    "attempt_3",
    "callback_scheduled",
    "dispatch_scheduled",
    "confirmed",
  ];

  test.each(NON_FERME_STATUSES)(
    "status=%s → null (caller falls back to default pill)",
    (status) => {
      expect(bucketFor(input({ status }))).toBe(null);
    },
  );

  test("status='cancelled' → null", () => {
    expect(bucketFor(input({ status: "cancelled" }))).toBe(null);
  });

  test("status='deleted' → null", () => {
    expect(bucketFor(input({ status: "deleted" }))).toBe(null);
  });
});
