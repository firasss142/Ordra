import { describe, expect, test } from "vitest";
import { NO_SIBLINGS, sameQueueOrders } from "../stable-orders";
import type { QueueOrder } from "@/types/queue";

function row(over: Partial<QueueOrder> = {}): QueueOrder {
  return {
    id: "o1",
    status: "pending",
    customer_name: "Amina",
    customer_phone: "20123456",
    customer_address: null,
    customer_city: "Tripoli",
    product_name: "Serum",
    variant_label: "",
    quantity: 1,
    product_image_url: null,
    carrier_id: null,
    carrier_code: null,
    carrier_name: null,
    total_price: 120,
    currency: "LYD",
    market_id: "m1",
    attempt_count: 0,
    callback_time: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    customer_note: null,
    customer_phone_2: null,
    created_at: "2026-08-01T08:00:00Z",
    assigned_at: "2026-08-01T08:00:00Z",
    last_action_at: null,
    repeat_kind: "none",
    prior_order_count: 0,
    prior_lead_count: 0,
    prior_rejected_count: 0,
    last_known_address: null,
    rejection_reason: null,
    rejection_subreason: null,
    rejection_note: null,
    is_potential_duplicate: false,
    duplicate_count: 0,
    duplicate_siblings: NO_SIBLINGS,
    has_uploaded_sibling: false,
    is_duplicate_anchor: false,
    tracking_number: null,
    carrier_barcode_deleted_at: null,
    dexpress_status_slug: null,
    dexpress_status_synced_at: null,
    dexpress_status_accepted: null,
    carrier_status_slug: null,
    carrier_status_synced_at: null,
    ...over,
  } as QueueOrder;
}

describe("sameQueueOrders", () => {
  test("identical content compares equal, so the memo can keep its reference", () => {
    const a = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    const b = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    expect(sameQueueOrders(a, b)).toBe(true);
  });

  // The regression the old length + first-id + last-id heuristic could not see:
  // same length, same first id, same last id, but the MIDDLE row changed. This
  // is the shape of every realtime status update.
  test("a status change on a middle row is detected", () => {
    const a = [row({ id: "a" }), row({ id: "b", status: "pending" }), row({ id: "c" })];
    const b = [row({ id: "a" }), row({ id: "b", status: "attempt_1" }), row({ id: "c" })];
    expect(sameQueueOrders(a, b)).toBe(false);
  });

  test("a field change on the only row is detected", () => {
    expect(sameQueueOrders([row()], [row({ attempt_count: 1 })])).toBe(false);
  });

  test("a callback time being set is detected", () => {
    const a = [row({ id: "a" }), row({ id: "b" })];
    const b = [row({ id: "a" }), row({ id: "b", callback_time: "2026-08-11T14:00:00Z" })];
    expect(sameQueueOrders(a, b)).toBe(false);
  });

  test("reordered rows are detected even though the id set is unchanged", () => {
    const a = [row({ id: "a" }), row({ id: "b" }), row({ id: "c" })];
    const b = [row({ id: "a" }), row({ id: "c" }), row({ id: "b" })];
    expect(sameQueueOrders(a, b)).toBe(false);
  });

  test("differing lengths compare unequal", () => {
    expect(sameQueueOrders([row()], [row(), row({ id: "o2" })])).toBe(false);
  });

  test("empty lists compare equal", () => {
    expect(sameQueueOrders([], [])).toBe(true);
  });

  test("NO_SIBLINGS keeps rows with no duplicates comparable", () => {
    expect(sameQueueOrders([row()], [row()])).toBe(true);
  });

  test("a changed sibling list is detected", () => {
    const siblings = [{ id: "s1" }] as unknown as QueueOrder["duplicate_siblings"];
    expect(
      sameQueueOrders(
        [row({ duplicate_siblings: NO_SIBLINGS })],
        [row({ duplicate_siblings: siblings })],
      ),
    ).toBe(false);
  });
});
