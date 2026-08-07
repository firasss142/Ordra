import { describe, it, expect } from "vitest";
import { presentAgentStatus } from "./agent-status";
import type { QueueOrder } from "@/types/queue";

const NOW = new Date("2026-08-07T12:00:00Z").getTime();

function order(over: Partial<QueueOrder> = {}): QueueOrder {
  return {
    id: "o-1",
    status: "pending",
    customer_name: "Ahmed Gharbi",
    customer_phone: "22123456",
    customer_address: null,
    customer_city: "Tunis",
    product_name: "T-Shirt",
    variant_label: "L",
    quantity: 1,
    product_image_url: null,
    carrier_code: null,
    carrier_name: null,
    total_price: 89.9,
    currency: "TND",
    market_id: null,
    attempt_count: 0,
    callback_time: null,
    scheduled_dispatch_at: null,
    scheduled_dispatch_auto: false,
    customer_note: null,
    customer_phone_2: null,
    created_at: "2026-08-01T10:00:00Z",
    assigned_at: "2026-08-01T10:00:00Z",
    last_action_at: null,
    repeat_kind: "none",
    prior_order_count: 0,
    prior_lead_count: 0,
    prior_rejected_count: 0,
    last_known_address: null,
    rejection_reason: null,
    rejection_note: null,
    is_potential_duplicate: false,
    duplicate_count: 0,
    duplicate_siblings: [],
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
  };
}

describe("presentAgentStatus", () => {
  it("uses the shared map for a plain pending order", () => {
    const p = presentAgentStatus(order({ status: "pending" }), { nowMs: NOW });
    expect(p).toMatchObject({ hue: "neutral", weight: "medium", glyph: "ring" });
    expect(p.label).toEqual({ ns: "orders.statuses", key: "pending" });
  });

  it("keeps confirmed violet, not green — the order has not left the agent's hands", () => {
    const p = presentAgentStatus(order({ status: "confirmed" }), { nowMs: NOW });
    expect(p.hue).toBe("violet");
    expect(p.glyph).toBe("check");
  });

  it("makes uploaded teal — the first state that is actually with the carrier", () => {
    const p = presentAgentStatus(
      order({ status: "uploaded", tracking_number: "TRK-1" }),
      { nowMs: NOW },
    );
    expect(p.hue).toBe("teal");
    expect(p.weight).toBe("quiet");
  });

  it("counts attempts from attempt_count, not from the status enum", () => {
    // attempt_3 is a cap; Libya's ceiling is 8. Reading the enum would say 3/3
    // and tell an agent they were out of attempts with five left.
    const p = presentAgentStatus(
      order({ status: "attempt_3", attempt_count: 5 }),
      { maxAttempts: 8, nowMs: NOW },
    );
    expect(p.datum).toEqual({ kind: "counter", value: "5/8" });
    expect(p.weight).toBe("medium");
  });

  it("goes loud only once attempts are actually exhausted", () => {
    const p = presentAgentStatus(
      order({ status: "attempt_3", attempt_count: 8 }),
      { maxAttempts: 8, nowMs: NOW },
    );
    expect(p.weight).toBe("loud");
  });

  it("shows a scheduled callback's time as the datum", () => {
    const at = "2026-08-07T17:30:00Z";
    const p = presentAgentStatus(
      order({ status: "callback_scheduled", callback_time: at }),
      { nowMs: NOW },
    );
    expect(p.datum).toEqual({ kind: "time", at });
    expect(p.hue).toBe("violet");
  });

  it("escalates an overdue callback to a loud red pill", () => {
    const p = presentAgentStatus(
      order({ status: "callback_scheduled", callback_time: "2026-08-07T09:00:00Z" }),
      { nowMs: NOW },
    );
    expect(p.hue).toBe("red");
    expect(p.weight).toBe("loud");
    expect(p.datum).toEqual({ kind: "overdue" });
  });

  it("shows a scheduled dispatch's time and escalates it when past due", () => {
    const future = presentAgentStatus(
      order({ status: "dispatch_scheduled", scheduled_dispatch_at: "2026-08-08T09:00:00Z" }),
      { nowMs: NOW },
    );
    expect(future.datum).toEqual({ kind: "time", at: "2026-08-08T09:00:00Z" });

    const past = presentAgentStatus(
      order({ status: "dispatch_scheduled", scheduled_dispatch_at: "2026-08-06T09:00:00Z" }),
      { nowMs: NOW },
    );
    expect(past.weight).toBe("loud");
  });

  it("follows the carrier lifecycle bucket, not the raw OMS status, once closed", () => {
    // bucketFor maps dispatched -> deposit, so the pill reflects what the
    // carrier portal actually says. Spec: plans/dexpress-list-status-bucket.md.
    const p = presentAgentStatus(order({ status: "dispatched" }), { nowMs: NOW });
    expect(p.label).toEqual({ ns: "orders.statuses", key: "bucket.deposit" });
    expect(p.hue).toBe("teal");
  });

  it("keeps a pending-acceptance Dexpress order on 'uploaded' despite a later-looking slug", () => {
    const p = presentAgentStatus(
      order({
        status: "uploaded",
        carrier_code: "dexpress",
        dexpress_status_slug: "AT_CUSTOMER",
        dexpress_status_accepted: false,
      }),
      { nowMs: NOW },
    );
    expect(p.label).toEqual({ ns: "orders.statuses", key: "bucket.uploaded" });
    expect(p.hue).toBe("teal");
  });

  it("flags a reference-deleted upload as agent work, overriding the carrier view", () => {
    const p = presentAgentStatus(
      order({
        status: "uploaded",
        tracking_number: null,
        carrier_barcode_deleted_at: "2026-08-05T10:00:00Z",
      }),
      { nowMs: NOW },
    );
    // Lives under orders.detail — the old code asked the queue namespace and
    // rendered the raw key.
    expect(p.label).toEqual({ ns: "orders.detail", key: "statusReferenceDeleted" });
    expect(p.hue).toBe("amber");
    expect(p.weight).toBe("loud");
  });

  it("omits the counter denominator until max attempts is known", () => {
    const p = presentAgentStatus(
      order({ status: "attempt_1", attempt_count: 1 }),
      { maxAttempts: null, nowMs: NOW },
    );
    expect(p.datum).toEqual({ kind: "counter", value: "1" });
    expect(p.weight).toBe("medium");
  });
});
