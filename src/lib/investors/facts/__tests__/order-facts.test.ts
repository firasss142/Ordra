import { describe, it, expect } from "vitest";
import { deriveOrderFacts, type OrderFactInput } from "@/lib/investors/facts/order-facts";

const DARB = { code: "darb_assabil", deliveryFee: 10, returnFee: 5, investorBillingMode: "billed_only" as const };
const NAVEX = { code: "navex", deliveryFee: 6, returnFee: 4, investorBillingMode: "flat_is_final" as const };

function input(over: Partial<OrderFactInput> & { status: string; history: OrderFactInput["history"] }): OrderFactInput {
  const { status, ...rest } = over;
  return {
    order: {
      id: "o1",
      marketId: "ly",
      status,
      productId: "p1",
      quantity: 1,
      totalPrice: 249,
      carrierId: "c1",
      createdAt: "2026-09-10T08:00:00Z",
    },
    carrier: DARB,
    items: [],
    billedShippingAmount: null,
    productCosts: new Map([["p1", { unitCogs: 40, packingCost: 0.5, processingCost: 0 }]]),
    existing: new Map(),
    timeZone: "Africa/Tripoli",
    now: "2026-10-03T12:00:00Z",
    ...rest,
  };
}

const SHIPPED = { statusTo: "uploaded", createdAt: "2026-09-10T09:00:00Z" };

describe("deriveOrderFacts — what a carrier costs an investor", () => {
  it("charges a delivered Darb parcel its invoice", () => {
    const [f] = deriveOrderFacts(
      input({
        status: "delivered",
        history: [SHIPPED, { statusTo: "delivered", createdAt: "2026-09-12T09:00:00Z" }],
        billedShippingAmount: 25,
      }),
    );
    expect(f.delivery_cost).toBe(25);
    expect(f.cost_source).toBe("billed");
    expect(f.is_final).toBe(true);
  });

  it("keeps an unbilled delivered Darb parcel pending — never the flat 10", () => {
    const [f] = deriveOrderFacts(
      input({ status: "delivered", history: [SHIPPED, { statusTo: "delivered", createdAt: "2026-09-12T09:00:00Z" }] }),
    );
    expect(f.delivery_cost).toBe(0);
    expect(f.is_final).toBe(false);
    expect(f.pending_reason).toBe("awaiting_billing");
  });

  it("charges NOTHING for a failed Darb parcel, even when Darb printed a shipping amount on it (owner, 2026-10-03)", () => {
    const [f] = deriveOrderFacts(
      input({
        status: "returned",
        history: [SHIPPED, { statusTo: "returned", createdAt: "2026-09-14T09:00:00Z" }],
        billedShippingAmount: 20,
      }),
    );
    expect(f.return_cost).toBe(0);
    expect(f.is_final).toBe(true);
    expect(f.pending_reason).toBeNull();
  });

  it("settles a failed Darb parcel that was never billed, instead of waiting for an invoice that never comes", () => {
    const [f] = deriveOrderFacts(
      input({ status: "returned", history: [SHIPPED, { statusTo: "returned", createdAt: "2026-09-14T09:00:00Z" }] }),
    );
    expect(f.return_cost).toBe(0);
    expect(f.is_final).toBe(true);
  });

  it("keeps Tunisia's flat return fee", () => {
    const [f] = deriveOrderFacts(
      input({
        status: "returned",
        carrier: NAVEX,
        history: [SHIPPED, { statusTo: "returned", createdAt: "2026-09-14T09:00:00Z" }],
      }),
    );
    expect(f.return_cost).toBe(4);
    expect(f.cost_source).toBe("flat");
  });
});
