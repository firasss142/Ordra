import { describe, it, expect } from "vitest";
import {
  MERGE_ELIGIBLE_STATUSES,
  canMergeOrderStatus,
  canMergeOrders,
  resolveMergeAddress,
  previewMergeTotal,
  type MergeableOrder,
} from "./merge";

function order(o: Partial<MergeableOrder> = {}): MergeableOrder {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    market_id: "m-ly",
    status: "pending",
    customer_phone: "0921185754",
    customer_address: "12 Rue X",
    customer_city: "Tripoli",
    product_id: "p-1",
    created_at: "2026-09-17T05:45:00Z",
    ...o,
  };
}

describe("MERGE_ELIGIBLE_STATUSES", () => {
  it("covers only the untouched pre-confirmation statuses", () => {
    expect([...MERGE_ELIGIBLE_STATUSES].sort()).toEqual(
      ["assigned", "attempt_1", "attempt_2", "attempt_3", "callback_scheduled", "pending"].sort(),
    );
  });

  it("excludes confirmed, though the duplicate dialog allows deleting it", () => {
    // A confirmed order had its total agreed with the customer by phone.
    // Silently changing that total is a different act from deleting a
    // duplicate the customer never discussed.
    expect(canMergeOrderStatus("confirmed")).toBe(false);
  });

  it("excludes carrier-committed and stock-deducted statuses", () => {
    for (const s of ["uploaded", "scanned", "dispatched", "delivered", "returned", "deleted"]) {
      expect(canMergeOrderStatus(s)).toBe(false);
    }
  });
});

describe("canMergeOrders", () => {
  const windowHours = 24;

  it("allows two untouched orders for the same customer, different products", () => {
    const a = order({ id: "a", product_id: "p-1", created_at: "2026-09-17T05:45:00Z" });
    const b = order({ id: "b", product_id: "p-2", created_at: "2026-09-17T11:15:00Z" });
    expect(canMergeOrders(a, b, { windowHours })).toEqual({ ok: true });
  });

  it("matches phones that differ only by formatting", () => {
    // The Libyan trunk zero: 0921185754 and +218921185754 are one subscriber.
    const a = order({ id: "a", customer_phone: "0921185754", product_id: "p-1" });
    const b = order({ id: "b", customer_phone: "+218 92 118 5754", product_id: "p-2" });
    expect(canMergeOrders(a, b, { windowHours }).ok).toBe(true);
  });

  it("refuses when the phones are genuinely different customers", () => {
    const a = order({ id: "a", customer_phone: "0921185754", product_id: "p-1" });
    const b = order({ id: "b", customer_phone: "0910000000", product_id: "p-2" });
    expect(canMergeOrders(a, b, { windowHours })).toEqual({
      ok: false,
      reason: "phone_mismatch",
    });
  });

  it("refuses when either order has moved past the agent's hands", () => {
    const a = order({ id: "a", product_id: "p-1" });
    const b = order({ id: "b", product_id: "p-2", status: "uploaded" });
    expect(canMergeOrders(a, b, { windowHours })).toEqual({
      ok: false,
      reason: "status_not_mergeable",
    });
  });

  it("refuses to merge an order with itself", () => {
    const a = order({ id: "a" });
    expect(canMergeOrders(a, a, { windowHours })).toEqual({ ok: false, reason: "same_order" });
  });

  it("refuses across markets, even for an identical phone", () => {
    const a = order({ id: "a", market_id: "m-ly", product_id: "p-1" });
    const b = order({ id: "b", market_id: "m-tn", product_id: "p-2" });
    expect(canMergeOrders(a, b, { windowHours })).toEqual({
      ok: false,
      reason: "cross_market",
    });
  });

  it("refuses when the orders are further apart than the window", () => {
    const a = order({ id: "a", product_id: "p-1", created_at: "2026-09-10T10:00:00Z" });
    const b = order({ id: "b", product_id: "p-2", created_at: "2026-09-17T10:00:00Z" });
    expect(canMergeOrders(a, b, { windowHours })).toEqual({
      ok: false,
      reason: "outside_window",
    });
  });

  it("refuses entirely when the market has merging disabled with a 0 window", () => {
    const a = order({ id: "a", product_id: "p-1" });
    const b = order({ id: "b", product_id: "p-2" });
    expect(canMergeOrders(a, b, { windowHours: 0 })).toEqual({
      ok: false,
      reason: "merge_disabled",
    });
  });
});

describe("resolveMergeAddress", () => {
  const survivor = order({ id: "a", customer_address: "12 Rue X", customer_city: "Tripoli" });
  const absorbed = order({ id: "b", customer_address: "99 Avenue Y", customer_city: "Benghazi" });

  /**
   * The finding that shapes this whole feature: of 187 different-product pairs
   * measured in Libya, 96 had a different address and 65 a different city. A
   * phone number is not a delivery destination, so the agent must choose and
   * the code must refuse to choose for them.
   */
  it("refuses to guess when the addresses differ and no choice was made", () => {
    expect(resolveMergeAddress(survivor, absorbed, null)).toEqual({
      ok: false,
      reason: "address_choice_required",
    });
  });

  it("takes the survivor's address when that is the explicit choice", () => {
    expect(resolveMergeAddress(survivor, absorbed, "survivor")).toEqual({
      ok: true,
      customer_address: "12 Rue X",
      customer_city: "Tripoli",
    });
  });

  it("takes the absorbed order's address when that is the explicit choice", () => {
    expect(resolveMergeAddress(survivor, absorbed, "absorbed")).toEqual({
      ok: true,
      customer_address: "99 Avenue Y",
      customer_city: "Benghazi",
    });
  });

  it("needs no choice when both orders already agree", () => {
    const same = order({ id: "b", customer_address: "12 Rue X", customer_city: "Tripoli" });
    expect(resolveMergeAddress(survivor, same, null)).toEqual({
      ok: true,
      customer_address: "12 Rue X",
      customer_city: "Tripoli",
    });
  });

  it("ignores case and surrounding whitespace when comparing", () => {
    const same = order({ id: "b", customer_address: "  12 RUE X ", customer_city: "tripoli" });
    expect(resolveMergeAddress(survivor, same, null).ok).toBe(true);
  });

  it("requires a choice when only the city differs", () => {
    const otherCity = order({ id: "b", customer_address: "12 Rue X", customer_city: "Benghazi" });
    expect(resolveMergeAddress(survivor, otherCity, null)).toEqual({
      ok: false,
      reason: "address_choice_required",
    });
  });
});

describe("previewMergeTotal", () => {
  /**
   * One parcel, one delivery fee. Charging both orders' fees is the obvious
   * bug this pins down.
   */
  it("charges a single delivery fee, not one per merged order", () => {
    const result = previewMergeTotal({
      survivorLines: [{ quantity: 1, unit_price: 50 }],
      absorbedLines: [{ quantity: 1, unit_price: 50 }],
      deliveryFee: 7,
      cardPayment: false,
      applyCardSurcharge: false,
    });
    expect(result.subtotal).toBe(100);
    expect(result.deliveryFee).toBe(7);
    expect(result.total).toBe(107);
  });

  it("sums quantities across both orders", () => {
    const result = previewMergeTotal({
      survivorLines: [{ quantity: 2, unit_price: 30 }],
      absorbedLines: [{ quantity: 3, unit_price: 10 }],
      deliveryFee: 0,
      cardPayment: false,
      applyCardSurcharge: false,
    });
    expect(result.subtotal).toBe(90);
    expect(result.quantity).toBe(5);
  });

  it("applies the 10% card surcharge to the product subtotal only, never the fee", () => {
    const result = previewMergeTotal({
      survivorLines: [{ quantity: 1, unit_price: 100 }],
      absorbedLines: [],
      deliveryFee: 10,
      cardPayment: true,
      applyCardSurcharge: true,
    });
    expect(result.total).toBe(120); // 100*1.1 + 10, not (100+10)*1.1
  });

  it("omits the surcharge for carriers that bill the card fee themselves", () => {
    const result = previewMergeTotal({
      survivorLines: [{ quantity: 1, unit_price: 100 }],
      absorbedLines: [],
      deliveryFee: 10,
      cardPayment: true,
      applyCardSurcharge: false,
    });
    expect(result.total).toBe(110);
  });

  it("rounds to millimes, matching orders.total_price NUMERIC(10,3)", () => {
    const result = previewMergeTotal({
      survivorLines: [{ quantity: 3, unit_price: 33.3333 }],
      absorbedLines: [],
      deliveryFee: 0,
      cardPayment: false,
      applyCardSurcharge: false,
    });
    expect(result.total).toBe(100);
  });
});
