import { describe, it, expect } from "vitest";
import { resolveOrderDispatch, type PreflightOrder } from "./bulk-dispatch-preflight";

const DARB = { code: "darb_assabil", market_id: "ly" };
const DEXPRESS = { code: "dexpress", market_id: "ly" };
const NAVEX = { code: "navex", market_id: "tn" };

// A confirmed Libya order with the fields the preflight inspects. Tests override
// per case.
function order(over: Partial<PreflightOrder> = {}): PreflightOrder {
  return {
    id: "o-1",
    status: "confirmed",
    market_id: "ly",
    customer_city: "اجدابيا", // single-area Darb city → resolveDarbAny gives a pair
    customer_address: "Rue 1",
    dexpress_state_id: null,
    ...over,
  };
}

const SVC = { darbDestination: null, defaultDarbServiceId: "svc-male" };

describe("resolveOrderDispatch — gates (status/market) before destination", () => {
  it("order_not_found when the row is missing from the batch", () => {
    expect(resolveOrderDispatch(undefined, DARB, SVC)).toEqual({
      eligible: false,
      reason: "order_not_found",
    });
  });

  it("wrong_status for any status outside confirmed/dispatch_scheduled", () => {
    for (const status of ["pending", "attempt_1", "uploaded", "scanned", "delivered"]) {
      expect(resolveOrderDispatch(order({ status }), DARB, SVC)).toEqual({
        eligible: false,
        reason: "wrong_status",
      });
    }
  });

  it("allows confirmed AND dispatch_scheduled", () => {
    expect(resolveOrderDispatch(order({ status: "confirmed" }), DARB, SVC).eligible).toBe(true);
    expect(
      resolveOrderDispatch(order({ status: "dispatch_scheduled" }), DARB, SVC).eligible,
    ).toBe(true);
  });

  it("wrong_market when the carrier's market differs from the order's", () => {
    expect(resolveOrderDispatch(order({ market_id: "tn" }), DARB, SVC)).toEqual({
      eligible: false,
      reason: "wrong_market",
    });
  });

  it("status is reported before market and before destination", () => {
    // uploaded + wrong market + missing address → still 'wrong_status' (first gate)
    expect(
      resolveOrderDispatch(
        order({ status: "uploaded", market_id: "tn", customer_address: null }),
        DARB,
        SVC,
      ),
    ).toEqual({ eligible: false, reason: "wrong_status" });
  });
});

describe("resolveOrderDispatch — Darb Assabil", () => {
  it("uses the persisted darb_destination pair (authoritative) and injects the default service", () => {
    const res = resolveOrderDispatch(
      order({ customer_city: "طرابلس" }), // multi-area, but a destination was picked & persisted
      DARB,
      { darbDestination: { city: "طرابلس", area: "عين زارة" }, defaultDarbServiceId: "svc-male" },
    );
    expect(res).toEqual({
      eligible: true,
      extra: {
        city: "طرابلس",
        customer_area: "عين زارة",
        service_id: "svc-male",
        service_fee_on_top: false,
      },
    });
  });

  it("falls back to resolveDarbAny for a single-area city when no destination is persisted", () => {
    const res = resolveOrderDispatch(order({ customer_city: "اجدابيا" }), DARB, SVC);
    expect(res.eligible).toBe(true);
    if (res.eligible) {
      expect(res.extra).toMatchObject({ city: "اجدابيا", customer_area: "اجدابيا", service_id: "svc-male" });
    }
  });

  it("no_destination for a multi-area city with no persisted destination (needs manual pick)", () => {
    expect(resolveOrderDispatch(order({ customer_city: "طرابلس" }), DARB, SVC)).toEqual({
      eligible: false,
      reason: "no_destination",
    });
  });

  it("no_destination for an unrecognized city", () => {
    expect(resolveOrderDispatch(order({ customer_city: "بلدة وهمية" }), DARB, SVC)).toEqual({
      eligible: false,
      reason: "no_destination",
    });
  });

  it("missing_address before destination resolution", () => {
    expect(
      resolveOrderDispatch(order({ customer_address: "  " }), DARB, SVC),
    ).toEqual({ eligible: false, reason: "missing_address" });
  });

  it("no_service when the batch has no default Darb service id (carrier default is empty)", () => {
    expect(
      resolveOrderDispatch(order({ customer_city: "اجدابيا" }), DARB, {
        darbDestination: null,
        defaultDarbServiceId: null,
      }),
    ).toEqual({ eligible: false, reason: "no_service" });
  });
});

describe("resolveOrderDispatch — Dexpress / Navex / unknown", () => {
  it("dexpress eligible with a saved state_id", () => {
    expect(
      resolveOrderDispatch(order({ dexpress_state_id: 62 }), DEXPRESS, SVC),
    ).toEqual({ eligible: true, extra: { state_id: 62 } });
  });

  it("dexpress no_state when dexpress_state_id is null", () => {
    expect(resolveOrderDispatch(order({ dexpress_state_id: null }), DEXPRESS, SVC)).toEqual({
      eligible: false,
      reason: "no_state",
    });
  });

  it("navex needs no destination extra", () => {
    expect(
      resolveOrderDispatch(order({ market_id: "tn" }), NAVEX, SVC),
    ).toEqual({ eligible: true, extra: undefined });
  });

  it("unknown_carrier for an unrecognized adapter code", () => {
    expect(
      resolveOrderDispatch(order(), { code: "mystery", market_id: "ly" }, SVC),
    ).toEqual({ eligible: false, reason: "unknown_carrier" });
  });
});
