import { describe, expect, test } from "vitest";
import {
  BUCKET_ORDER,
  HOT_WINDOW_MINUTES,
  bucketOf,
  countBuckets,
  sumBuckets,
  sortWorklist,
  attemptCount,
  applyOutcome,
  isCallbackDue,
} from "../worklist";
import type { ProspectRow } from "../types";

/** 2026-09-14 12:00 Tripoli. Every call below passes this explicitly. */
const NOW = Date.parse("2026-09-14T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const minutesAhead = (m: number) => new Date(NOW + m * 60_000).toISOString();

function row(over: Partial<ProspectRow> = {}): ProspectRow {
  return {
    id: "l1",
    market_id: "m1",
    status: "assigned",
    source: "whatsapp",
    bucket: "hot",
    customer_name: "أمل الزنتاني",
    customer_phone: "0917788001",
    customer_city: "طرابلس",
    customer_address: null,
    product_id: null,
    product_name: null,
    product_price: null,
    product_image_url: null,
    product_note: null,
    notes: null,
    assigned_to: "a1",
    assigned_name: "Hend",
    callback_scheduled_at: null,
    converted_order_id: null,
    converted_order_ref: null,
    campaign_id: null,
    campaign_name: null,
    campaign_offer: null,
    campaign_script: null,
    source_order_id: null,
    source_order_ref: null,
    return_reason: null,
    repeat_kind: "none",
    prior_order_count: 0,
    prior_delivered_count: 0,
    prior_returned_count: 0,
    last_known_address: null,
    created_at: minutesAgo(6),
    updated_at: minutesAgo(6),
    last_touch_at: null,
    ...over,
  };
}

describe("bucketOf", () => {
  test("a converted lead is done, whatever else is true of it", () => {
    const r = row({
      converted_order_id: "o1",
      status: "won",
      source: "campaign",
      campaign_id: "c1",
      callback_scheduled_at: minutesAhead(30),
    });
    expect(bucketOf(r, NOW)).toBe("converted");
  });

  test("a lead born from a returned parcel is a win-back, not a fresh inbound", () => {
    const r = row({ source: "winback", source_order_id: "o9", created_at: minutesAgo(2) });
    expect(bucketOf(r, NOW)).toBe("winback");
  });

  // 1 982 production campaign leads carry source_order_id — it points at the
  // customer's PAST order, which is how the campaign audience was built. Only
  // source='winback' means a parcel came back. Reading the link as the signal
  // would file the entire campaign list under Retours.
  test("a campaign lead that points at a past order is campaign stock, not a win-back", () => {
    const r = row({ source: "campaign", campaign_id: "c1", status: "new", source_order_id: "o9" });
    expect(bucketOf(r, NOW)).toBe("campaign");
  });

  test("an inbound message nobody has answered yet is hot", () => {
    expect(bucketOf(row({ source: "whatsapp", created_at: minutesAgo(6) }), NOW)).toBe("hot");
  });

  // Decision 31: hot = inbound source, first contact not yet made, younger than
  // the market's lead_hot_window_minutes. Past the window it is a normal call.
  test("an inbound message goes cold once it is older than the hot window", () => {
    const r = row({ source: "whatsapp", created_at: minutesAgo(HOT_WINDOW_MINUTES + 1) });
    expect(bucketOf(r, NOW)).toBe("retry");
  });

  test("a campaign lead is never hot — nobody is waiting on the other end", () => {
    const r = row({ source: "campaign", campaign_id: "c1", status: "new", created_at: minutesAgo(2) });
    expect(bucketOf(r, NOW)).toBe("campaign");
  });

  test("a campaign lead that has been called is a retry, not campaign stock", () => {
    const r = row({ source: "campaign", campaign_id: "c1", status: "attempt_1" });
    expect(bucketOf(r, NOW)).toBe("retry");
  });

  test("a scheduled callback outranks the attempts that produced it", () => {
    const r = row({ status: "callback_scheduled", callback_scheduled_at: minutesAhead(95) });
    expect(bucketOf(r, NOW)).toBe("callback");
  });

  test("a callback whose time has passed is still a callback, so it sorts to the top rather than hiding among retries", () => {
    const r = row({ status: "callback_scheduled", callback_scheduled_at: minutesAgo(25) });
    expect(bucketOf(r, NOW)).toBe("callback");
  });

  test("an answered call that produced no callback is a retry", () => {
    expect(bucketOf(row({ status: "attempt_2" }), NOW)).toBe("retry");
  });

  // 1 963 of 1 992 production leads are status=new from a campaign import.
  // Treating "new" as hot would put two thousand rows in the urgent bucket.
  test("an untouched lead with no inbound source is not hot", () => {
    const r = row({ source: "manual_call", status: "new", campaign_id: null, created_at: minutesAgo(1) });
    expect(bucketOf(r, NOW)).toBe("retry");
  });
});

describe("isCallbackDue", () => {
  test("a callback in the future is not due", () => {
    expect(isCallbackDue(row({ callback_scheduled_at: minutesAhead(10) }), NOW)).toBe(false);
  });

  test("a callback whose time has come is due", () => {
    expect(isCallbackDue(row({ callback_scheduled_at: minutesAgo(1) }), NOW)).toBe(true);
  });

  test("a lead with no callback is never due", () => {
    expect(isCallbackDue(row({ callback_scheduled_at: null }), NOW)).toBe(false);
  });
});

describe("attemptCount", () => {
  test("reads the number off the attempt status", () => {
    expect(attemptCount(row({ status: "attempt_3" }))).toBe(3);
  });

  test("a lead nobody has called yet has no attempts", () => {
    expect(attemptCount(row({ status: "assigned" }))).toBe(0);
  });

  test("a callback carries no attempt number of its own", () => {
    // callback_scheduled loses the attempt number in the enum; the chip shows
    // the callback time instead, so zero is the honest answer here.
    expect(attemptCount(row({ status: "callback_scheduled" }))).toBe(0);
  });
});

describe("countBuckets and sumBuckets", () => {
  const rows = [
    row({ id: "a", bucket: "hot", product_price: 110 }),
    row({ id: "b", bucket: "hot", product_price: 240 }),
    row({ id: "c", bucket: "callback", product_price: null }),
    row({ id: "d", bucket: "converted", product_price: 95 }),
  ];

  test("counts every bucket and the total", () => {
    expect(countBuckets(rows)).toEqual({
      all: 4, hot: 2, callback: 1, retry: 0, campaign: 0, winback: 0, converted: 1,
    });
  });

  test("sums the potential value, treating a lead with no product as worth nothing rather than skipping it", () => {
    expect(sumBuckets(rows)).toEqual({
      all: 445, hot: 350, callback: 0, retry: 0, campaign: 0, winback: 0, converted: 95,
    });
  });
});

describe("sortWorklist", () => {
  test("buckets come in the prototype's order: hot, then callbacks, then the rest", () => {
    const rows = [
      row({ id: "conv", bucket: "converted" }),
      row({ id: "camp", bucket: "campaign" }),
      row({ id: "hot", bucket: "hot" }),
      row({ id: "cb", bucket: "callback", callback_scheduled_at: minutesAhead(5) }),
    ];
    expect(sortWorklist(rows, NOW).map((r) => r.id)).toEqual(["hot", "cb", "camp", "conv"]);
  });

  test("an overdue callback comes before one that is still in the future", () => {
    const rows = [
      row({ id: "later", bucket: "callback", callback_scheduled_at: minutesAhead(120) }),
      row({ id: "overdue", bucket: "callback", callback_scheduled_at: minutesAgo(25) }),
    ];
    expect(sortWorklist(rows, NOW).map((r) => r.id)).toEqual(["overdue", "later"]);
  });

  test("within the hot bucket the oldest waits first — the 10-minute rule makes it the most urgent, not the least", () => {
    const rows = [
      row({ id: "new", bucket: "hot", created_at: minutesAgo(3) }),
      row({ id: "old", bucket: "hot", created_at: minutesAgo(41) }),
    ];
    expect(sortWorklist(rows, NOW).map((r) => r.id)).toEqual(["old", "new"]);
  });

  test("BUCKET_ORDER drives the ordering, so the two never drift apart", () => {
    expect(BUCKET_ORDER).toEqual(["hot", "callback", "retry", "campaign", "winback", "converted"]);
  });
});

describe("applyOutcome", () => {
  test("no answer bumps the attempt and moves the row to retry", () => {
    const next = applyOutcome(row({ status: "assigned", bucket: "hot" }), { kind: "no_answer" }, NOW);
    expect(next.status).toBe("attempt_1");
    expect(next.bucket).toBe("retry");
  });

  test("a third failed attempt does not invent an attempt_4", () => {
    const next = applyOutcome(row({ status: "attempt_3" }), { kind: "no_answer" }, NOW);
    expect(next.status).toBe("attempt_3");
  });

  test("scheduling a callback stores the time and moves the row to the callback bucket", () => {
    const at = minutesAhead(120);
    const next = applyOutcome(row({ status: "attempt_1" }), { kind: "callback", at }, NOW);
    expect(next.status).toBe("callback_scheduled");
    expect(next.callback_scheduled_at).toBe(at);
    expect(next.bucket).toBe("callback");
  });

  test("marking a prospect lost takes it out of every working bucket", () => {
    const next = applyOutcome(row(), { kind: "lost", reason: "price" }, NOW);
    expect(next.status).toBe("lost");
  });

  test("a won prospect shows its order and sits in converted", () => {
    const next = applyOutcome(row(), { kind: "converted", orderId: "o7", orderRef: "48219" }, NOW);
    expect(next.bucket).toBe("converted");
    expect(next.converted_order_id).toBe("o7");
    expect(next.converted_order_ref).toBe("48219");
  });

  test("the prediction never mutates the row it was given", () => {
    const before = row({ status: "assigned" });
    applyOutcome(before, { kind: "no_answer" }, NOW);
    expect(before.status).toBe("assigned");
  });
});
