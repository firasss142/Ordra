/**
 * Tests for the carrier-neutral fermé-tab bucket function.
 *
 * Covers BOTH carriers:
 *   - Dexpress (ported from the original dexpress/buckets.test.ts — guarantees
 *     the promotion to carriers/buckets.ts changed no Dexpress behavior).
 *   - Darb Assabil (the new carrier-aware branch + the new 'cancelled' bucket).
 *
 * Spec: plans/darb-assabil-status-display.md.
 */

import { describe, test, expect } from "vitest";
import { bucketFor, type BucketInput } from "./buckets";
import type { DexpressSlug } from "./dexpress/statuses";
import type { DarbSlug } from "./darb-assabil-statuses";

function input(overrides: Partial<BucketInput>): BucketInput {
  return {
    status: "uploaded",
    carrierCode: "dexpress",
    dexpressStatusSlug: null,
    dexpressStatusAccepted: null,
    carrierStatusSlug: null,
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════════
// DEXPRESS (regression — behavior must be identical to the v1 function)
// ════════════════════════════════════════════════════════════════════
describe("bucketFor — Dexpress: Rejected (OMS-side)", () => {
  test("status=rejected always returns 'rejected', regardless of slug", () => {
    expect(bucketFor(input({ status: "rejected" }))).toBe("rejected");
    expect(
      bucketFor(input({ status: "rejected", dexpressStatusSlug: "DELIVERED" })),
    ).toBe("rejected");
  });

  test("status=rejected returns 'rejected' even on a non-Dexpress carrier", () => {
    expect(bucketFor(input({ status: "rejected", carrierCode: "navex" }))).toBe(
      "rejected",
    );
  });
});

describe("bucketFor — Dexpress: Deposit (in-flight slugs)", () => {
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

  test.each(DEPOSIT_SLUGS)("slug %s → 'deposit'", (slug) => {
    expect(bucketFor(input({ dexpressStatusSlug: slug }))).toBe("deposit");
  });

  test("OMS status='dispatched' with no slug → 'deposit'", () => {
    expect(bucketFor(input({ status: "dispatched", dexpressStatusSlug: null }))).toBe(
      "deposit",
    );
  });
});

describe("bucketFor — Dexpress: Delivered", () => {
  const DELIVERED_SLUGS: DexpressSlug[] = [
    "DELIVERED",
    "AWAITING_COURIER_SETTLEMENT",
    "PARTIALLY_DELIVERED",
  ];
  test.each(DELIVERED_SLUGS)("slug %s → 'delivered'", (slug) => {
    expect(bucketFor(input({ dexpressStatusSlug: slug }))).toBe("delivered");
  });
  test("OMS status='delivered' → 'delivered'", () => {
    expect(bucketFor(input({ status: "delivered" }))).toBe("delivered");
  });
});

describe("bucketFor — Dexpress: Returned", () => {
  const RETURNED_SLUGS: DexpressSlug[] = [
    "RECEIPT_REFUSED",
    "RETURNING_VIA_COURIER",
    "RETURNING_AT_BRANCHES",
    "RETURNING_TO_COMPANY",
    "RETURNED_AT_COMPANY",
  ];
  test.each(RETURNED_SLUGS)("slug %s → 'returned'", (slug) => {
    expect(bucketFor(input({ dexpressStatusSlug: slug }))).toBe("returned");
  });
  test("OMS status='returned' → 'returned'", () => {
    expect(bucketFor(input({ status: "returned" }))).toBe("returned");
  });
});

describe("bucketFor — Dexpress: Uploaded fallback + accepted override", () => {
  test("uploaded, slug=null → 'uploaded'", () => {
    expect(bucketFor(input({ status: "uploaded", dexpressStatusSlug: null }))).toBe(
      "uploaded",
    );
  });
  test("uploaded, unknown slug → 'uploaded' (graceful degradation)", () => {
    expect(
      bucketFor(input({ status: "uploaded", dexpressStatusSlug: "WAT_IS_THIS" })),
    ).toBe("uploaded");
  });
  test("AT_CUSTOMER, accepted=false → 'uploaded'", () => {
    expect(
      bucketFor(
        input({ dexpressStatusSlug: "AT_CUSTOMER", dexpressStatusAccepted: false }),
      ),
    ).toBe("uploaded");
  });
  test("AT_CUSTOMER, accepted=true → 'deposit'", () => {
    expect(
      bucketFor(
        input({ dexpressStatusSlug: "AT_CUSTOMER", dexpressStatusAccepted: true }),
      ),
    ).toBe("deposit");
  });
  test("accepted=false does NOT override delivered/rejected terminals", () => {
    expect(
      bucketFor(
        input({
          status: "delivered",
          dexpressStatusSlug: "DELIVERED",
          dexpressStatusAccepted: false,
        }),
      ),
    ).toBe("delivered");
  });
});

// ════════════════════════════════════════════════════════════════════
// DARB ASSABIL (new carrier branch + 'cancelled' bucket)
// ════════════════════════════════════════════════════════════════════
describe("bucketFor — Darb Assabil: Uploaded (pending/booked/processing)", () => {
  const UPLOADED_SLUGS: DarbSlug[] = ["pending", "booked", "processing"];
  test.each(UPLOADED_SLUGS)("slug %s → 'uploaded' (handed over, not moving)", (slug) => {
    expect(
      bucketFor(input({ carrierCode: "darb_assabil", carrierStatusSlug: slug })),
    ).toBe("uploaded");
  });

  test("no slug yet (never synced) → 'uploaded'", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "darb_assabil",
          carrierStatusSlug: null,
        }),
      ),
    ).toBe("uploaded");
  });
});

describe("bucketFor — Darb Assabil: Deposit (in the network)", () => {
  const DEPOSIT_SLUGS: DarbSlug[] = [
    "on-branch",
    "released",
    "resent",
    "delayed",
    "returning",
  ];
  test.each(DEPOSIT_SLUGS)("slug %s → 'deposit'", (slug) => {
    expect(
      bucketFor(input({ carrierCode: "darb_assabil", carrierStatusSlug: slug })),
    ).toBe("deposit");
  });
});

describe("bucketFor — Darb Assabil: terminal buckets", () => {
  test("completed → 'delivered'", () => {
    expect(
      bucketFor(input({ carrierCode: "darb_assabil", carrierStatusSlug: "completed" })),
    ).toBe("delivered");
  });

  test("returned → 'returned'", () => {
    expect(
      bucketFor(input({ carrierCode: "darb_assabil", carrierStatusSlug: "returned" })),
    ).toBe("returned");
  });

  test("cancelled → 'cancelled' (its own bucket)", () => {
    expect(
      bucketFor(input({ carrierCode: "darb_assabil", carrierStatusSlug: "cancelled" })),
    ).toBe("cancelled");
  });
});

describe("bucketFor — Darb Assabil: edge cases", () => {
  test("unknown Darb slug → 'uploaded' (graceful degradation via OMS status)", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "darb_assabil",
          carrierStatusSlug: "teleported",
        }),
      ),
    ).toBe("uploaded");
  });

  test("OMS rejected wins over a Darb carrier slug", () => {
    expect(
      bucketFor(
        input({
          status: "rejected",
          carrierCode: "darb_assabil",
          carrierStatusSlug: "completed",
        }),
      ),
    ).toBe("rejected");
  });

  test("a Darb slug leaked onto a Dexpress order is ignored (carrier-scoped)", () => {
    expect(
      bucketFor(
        input({
          status: "uploaded",
          carrierCode: "dexpress",
          carrierStatusSlug: "cancelled",
          dexpressStatusSlug: null,
        }),
      ),
    ).toBe("uploaded");
  });
});

describe("bucketFor — orders that don't belong in fermé", () => {
  const NON_FERME_STATUSES = [
    "pending",
    "attempt_1",
    "callback_scheduled",
    "confirmed",
    "cancelled",
    "deleted",
  ];
  test.each(NON_FERME_STATUSES)("status=%s → null", (status) => {
    expect(bucketFor(input({ status, carrierStatusSlug: null }))).toBe(null);
  });
});
