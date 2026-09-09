import { describe, test, expect } from "vitest";
import {
  ORDER_STATUSES,
  ALL_ORDER_STATUSES,
  CARRIER_PHASE_STATUSES,
  IN_FLIGHT_STATUSES,
  canTransition,
  isTerminalStatus,
  type OrderStatus,
} from "../order-status";

/**
 * The statuses Darb actually reports.
 *
 * A Libyan parcel used to stay "scanned" from handover to delivery: booked,
 * processing, on-branch, released, resent and delayed changed nothing here, so
 * `dispatched`, `deposit` and `in_transit` were never occupied by a Darb order
 * and /in-delivery could not see one. These four statuses are the carrier's own
 * vocabulary, and this file is what keeps the TypeScript table honest against
 * `transition_order_status` in SQL.
 */
describe("the Darb-shaped statuses", () => {
  test.each(["at_carrier", "out_for_delivery", "delivery_delayed", "returning"])(
    "%s is part of the vocabulary",
    (s) => {
      expect(ORDER_STATUSES).toContain(s as OrderStatus);
    },
  );

  test("every status has a transition list — none throws when asked", () => {
    for (const from of ALL_ORDER_STATUSES) {
      expect(() => canTransition(from, "deleted")).not.toThrow();
    }
  });

  test("'new' no longer throws", () => {
    // `new` still exists in Postgres and is still an accepted arm in SQL, but it
    // was missing from the TS table, so canTransition('new', …) threw.
    expect(() => canTransition("new" as OrderStatus, "pending")).not.toThrow();
  });
});

describe("the carrier phase", () => {
  test("a scanned parcel goes to the carrier, not straight to a truck", () => {
    expect(canTransition("scanned", "at_carrier")).toBe(true);
  });

  test("a scanned parcel can be un-scanned back onto the bench", () => {
    // The reversal P3 relies on: stock returns, the order goes back to prepare.
    expect(canTransition("scanned", "uploaded")).toBe(true);
  });

  test("delayed and out-for-delivery swap freely, in both directions", () => {
    expect(canTransition("out_for_delivery", "delivery_delayed")).toBe(true);
    expect(canTransition("delivery_delayed", "out_for_delivery")).toBe(true);
  });

  test("a parcel on its way back is not receivable yet", () => {
    // `returning` is the carrier saying "it is coming back"; only `to_be_returned`
    // means it is here and the bench may scan it in.
    expect(canTransition("returning", "to_be_returned")).toBe(true);
    expect(canTransition("returning", "received")).toBe(false);
  });

  test("uploaded no longer claims it can reach delivered on its own", () => {
    // The TS table said uploaded → delivered|returned|cancelled, citing a
    // migration that had been superseded. SQL refuses all three.
    expect(canTransition("uploaded", "delivered")).toBe(false);
    expect(canTransition("uploaded", "returned")).toBe(false);
    expect(canTransition("uploaded", "cancelled")).toBe(false);
  });

  test("a re-received parcel can go back out — it is not a dead end", () => {
    // `received` had no outbound arm at all, so a parcel the customer still
    // wanted could never close, never got terminal_at and never archived.
    expect(canTransition("received", "confirmed")).toBe(true);
  });

  test("none of the four new statuses is terminal", () => {
    for (const s of ["at_carrier", "out_for_delivery", "delivery_delayed", "returning"] as OrderStatus[]) {
      expect(isTerminalStatus(s)).toBe(false);
    }
  });
});

describe("the shared sets", () => {
  test("the carrier phase holds every status a parcel occupies after the bench", () => {
    expect(CARRIER_PHASE_STATUSES).toEqual(
      expect.arrayContaining([
        "at_carrier", "dispatched", "deposit", "in_transit",
        "out_for_delivery", "delivery_delayed", "returning", "to_be_returned",
      ]),
    );
  });

  test("in-flight excludes anything settled", () => {
    for (const s of ["delivered", "returned", "cancelled", "rejected", "deleted"] as OrderStatus[]) {
      expect(IN_FLIGHT_STATUSES).not.toContain(s);
    }
  });

  test("in-flight includes the four new ones, so reporting can see a moving parcel", () => {
    for (const s of ["at_carrier", "out_for_delivery", "delivery_delayed", "returning"] as OrderStatus[]) {
      expect(IN_FLIGHT_STATUSES).toContain(s);
    }
  });
});
