import { describe, it, expect } from "vitest";
import {
  mergeAnchorWithHistory,
  computeTrackRecord,
  type HistoryRow,
} from "./summary";

function row(o: Partial<HistoryRow> = {}): HistoryRow {
  return {
    id: "o-1",
    external_id: "EXT-1",
    created_at: "2026-06-10T12:00:00Z",
    status: "delivered",
    total_price: 129,
    product_name: "دميه ملاكمه حجم صغير",
    product_image_url: null,
    quantity: 1,
    is_anchor: false,
    ...o,
  };
}

describe("mergeAnchorWithHistory", () => {
  /**
   * The bug this exists to fix: get_customer_history_detail EXCLUDES the order
   * you are looking at, so a customer whose current order is delivered comes
   * back with delivered_count 0 and lifetime_value 0. Folding the anchor back
   * in is what makes the panel's figures describe the customer rather than
   * "the customer, minus the row on screen".
   */
  it("includes the anchor order in the list", () => {
    const rows = mergeAnchorWithHistory(
      row({ id: "anchor", external_id: "ANCHOR" }),
      [row({ id: "old", external_id: "OLD", created_at: "2026-05-29T14:15:00Z" })],
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.id)).toContain("anchor");
  });

  it("marks exactly one row as the anchor", () => {
    const rows = mergeAnchorWithHistory(row({ id: "anchor" }), [row({ id: "a" }), row({ id: "b" })]);
    expect(rows.filter((r) => r.is_anchor).map((r) => r.id)).toEqual(["anchor"]);
  });

  it("sorts newest first", () => {
    const rows = mergeAnchorWithHistory(
      row({ id: "mid", created_at: "2026-06-10T12:00:00Z" }),
      [
        row({ id: "oldest", created_at: "2026-05-29T14:15:00Z" }),
        row({ id: "newest", created_at: "2026-06-16T15:00:00Z" }),
      ],
    );
    expect(rows.map((r) => r.id)).toEqual(["newest", "mid", "oldest"]);
  });

  it("never lists the anchor twice when the API also returned it", () => {
    // Defensive: the RPC excludes it by id, but a phone-matched duplicate row
    // carrying the same id would otherwise double the totals.
    const rows = mergeAnchorWithHistory(row({ id: "anchor" }), [row({ id: "anchor" })]);
    expect(rows).toHaveLength(1);
  });
});

describe("computeTrackRecord", () => {
  it("counts delivered orders and the value actually realised", () => {
    const tr = computeTrackRecord([
      row({ id: "a", status: "delivered", total_price: 129 }),
      row({ id: "b", status: "delivered", total_price: 71 }),
      row({ id: "c", status: "rejected", total_price: 500 }),
    ]);
    expect(tr.deliveredCount).toBe(2);
    expect(tr.deliveredValue).toBe(200);
  });

  it("counts what is still in flight separately from what is realised", () => {
    // Money on a parcel at the carrier is not revenue yet, and a panel that
    // adds it to the delivered total tells the manager they earned it.
    const tr = computeTrackRecord([
      row({ id: "a", status: "delivered", total_price: 129 }),
      row({ id: "b", status: "uploaded", total_price: 387 }),
    ]);
    expect(tr.deliveredValue).toBe(129);
    expect(tr.inFlightCount).toBe(1);
    expect(tr.inFlightValue).toBe(387);
  });

  /**
   * Delivery rate = delivered ÷ (delivered + returned). Only parcels that
   * reached a conclusion can be in the denominator — counting an in-flight
   * parcel as a failure would punish a customer for our own carrier lag.
   */
  it("reads the delivery rate over concluded parcels only", () => {
    const tr = computeTrackRecord([
      row({ id: "a", status: "delivered" }),
      row({ id: "b", status: "returned" }),
      row({ id: "c", status: "uploaded" }),
    ]);
    expect(tr.delivery).toEqual({ n: 1, d: 2 });
  });

  it("returns no delivery rate when nothing has concluded", () => {
    // A rate with an empty denominator is not 0 % or 100 %, it is unknown —
    // and the panel must be able to say so rather than print a number.
    const tr = computeTrackRecord([row({ id: "a", status: "uploaded" })]);
    expect(tr.delivery).toBeNull();
  });

  /**
   * Confirmation rate = confirmed-or-beyond ÷ (that + rejected). The real
   * customer this was built on: 1 delivered + 1 uploaded vs 1 rejected = 2/3.
   */
  it("reads the confirmation rate over decided orders only", () => {
    const tr = computeTrackRecord([
      row({ id: "a", status: "delivered" }),
      row({ id: "b", status: "uploaded" }),
      row({ id: "c", status: "rejected" }),
    ]);
    expect(tr.confirmation).toEqual({ n: 2, d: 3 });
  });

  it("does not let an undecided order into the confirmation denominator", () => {
    const tr = computeTrackRecord([
      row({ id: "a", status: "delivered" }),
      row({ id: "b", status: "pending" }),
      row({ id: "c", status: "attempt_2" }),
      row({ id: "d", status: "callback_scheduled" }),
    ]);
    expect(tr.confirmation).toEqual({ n: 1, d: 1 });
  });

  it("does not count a manager cancellation against the customer", () => {
    // `cancelled` is ours, not theirs. In the denominator it would read as the
    // customer refusing, which is the opposite of what happened.
    const tr = computeTrackRecord([
      row({ id: "a", status: "delivered" }),
      row({ id: "b", status: "cancelled" }),
    ]);
    expect(tr.confirmation).toEqual({ n: 1, d: 1 });
  });

  it("counts a returned parcel as confirmed — the customer did say yes", () => {
    const tr = computeTrackRecord([
      row({ id: "a", status: "returned" }),
      row({ id: "b", status: "rejected" }),
    ]);
    expect(tr.confirmation).toEqual({ n: 1, d: 2 });
    expect(tr.delivery).toEqual({ n: 0, d: 1 });
  });

  it("returns no confirmation rate when nothing has been decided", () => {
    const tr = computeTrackRecord([row({ id: "a", status: "pending" })]);
    expect(tr.confirmation).toBeNull();
  });

  /**
   * The reason every rate ships with its denominator: one delivered parcel is
   * "100 %" and so is a hundred. The panel has to be able to tell them apart.
   */
  it("flags a rate drawn from too few orders to lean on", () => {
    const thin = computeTrackRecord([row({ id: "a", status: "delivered" })]);
    expect(thin.isThin).toBe(true);

    const solid = computeTrackRecord(
      Array.from({ length: 5 }, (_, i) => row({ id: `o${i}`, status: "delivered" })),
    );
    expect(solid.isThin).toBe(false);
  });

  it("judges thinness on the weakest rate, not the strongest", () => {
    // The real customer this was built on: 3 decided orders, but only ONE
    // concluded parcel behind the "100 %". Taking the widest denominator would
    // let the confirmation rate vouch for a delivery rate drawn from one box.
    const tr = computeTrackRecord([
      row({ id: "a", status: "delivered" }),
      row({ id: "b", status: "uploaded" }),
      row({ id: "c", status: "rejected" }),
    ]);
    expect(tr.confirmation).toEqual({ n: 2, d: 3 });
    expect(tr.delivery).toEqual({ n: 1, d: 1 });
    expect(tr.isThin).toBe(true);
  });

  it("does not cry thin when there is no rate to qualify", () => {
    const tr = computeTrackRecord([row({ id: "a", status: "pending" })]);
    expect(tr.delivery).toBeNull();
    expect(tr.confirmation).toBeNull();
    expect(tr.isThin).toBe(false);
  });

  it("handles an empty list without inventing figures", () => {
    const tr = computeTrackRecord([]);
    expect(tr).toMatchObject({
      deliveredCount: 0,
      deliveredValue: 0,
      inFlightCount: 0,
      inFlightValue: 0,
      delivery: null,
      confirmation: null,
    });
  });

  it("tolerates a missing price rather than producing NaN", () => {
    const tr = computeTrackRecord([
      row({ id: "a", status: "delivered", total_price: null as unknown as number }),
    ]);
    expect(tr.deliveredValue).toBe(0);
  });
});
