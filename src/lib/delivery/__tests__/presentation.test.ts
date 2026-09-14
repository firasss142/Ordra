import { describe, test, expect } from "vitest";
import { situationOf, moveFor, formatPhone, dayPart, orderRef, BUCKET_TONE, moveTone, quickOutcomesFor } from "../presentation";
import type { WorklistRow } from "../types";

const NOW = Date.parse("2026-09-13T10:30:00Z");

function row(over: Partial<WorklistRow> = {}): WorklistRow {
  return {
    order_id: "o1", external_id: "48211", status: "in_transit", bucket: "waiting_carrier",
    reason_codes: [], hours_on_status: 6, next_action_at: null, is_risky: false, risk_reasons: [],
    total_price: 185, customer_name: "Amina", customer_phone: "0914456677", customer_phone_2: null,
    customer_city: "Tripoli", customer_address: "Aïn Zara", assigned_to: "a1", agent_name: "Hend",
    tracking_number: "T1", carrier_id: "c1", carrier_status_slug: null, latest_remark: null,
    latest_remark_at: null, remark_class: null, delayed_until: null, resend_count: 0,
    handler_name: "Ali", handler_phone: "0912345678", handler_account_name: "Agence", handler_account_phone: "0917710099",
    to_branch_group: null, latest_event_at: null, customer_orders_count: 1, customer_delivered_count: 0,
    customer_returned_count: 0, customer_rejected_count: 0, customer_risk_class: "repeat",
    last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null,
    has_open_task: false, terminal_at: null, created_at: "2026-09-12T08:00:00Z", carrier_name: "Darb Assabil",
    items: [], ...over,
  };
}

describe("BUCKET_TONE", () => {
  test("one hue per bucket, as in the prototype", () => {
    expect(BUCKET_TONE).toEqual({ returning: "red", act_now: "amber", waiting_customer: "blue", waiting_carrier: "grey", done: "green" });
  });
});

describe("situationOf", () => {
  test("act now reads the most specific reason first", () => {
    expect(situationOf(row({ bucket: "act_now", has_open_task: true, reason_codes: ["proactive", "remark:no_answer"] }), NOW))
      .toMatchObject({ key: "proactive", tone: "amber", hours: 6, sub: { key: "proactive" } });
    expect(situationOf(row({ bucket: "act_now", reason_codes: ["stalled:5"], hours_on_status: 150 }), NOW))
      .toMatchObject({ key: "stalled", hours: 150 });
    expect(situationOf(row({ bucket: "act_now", reason_codes: ["remark:no_answer"] }), NOW)).toMatchObject({ key: "no_answer" });
    expect(situationOf(row({ bucket: "act_now", reason_codes: ["remark:wrong_address"] }), NOW)).toMatchObject({ key: "address" });
    expect(situationOf(row({ bucket: "act_now", reason_codes: ["remark:out_of_coverage"] }), NOW)).toMatchObject({ key: "out_of_coverage" });
    expect(situationOf(row({ bucket: "act_now", reason_codes: ["remark:not_needed"] }), NOW)).toMatchObject({ key: "cancel" });
    expect(situationOf(row({ bucket: "act_now", status: "delivery_delayed", reason_codes: ["delayed"], hours_on_status: 26 }), NOW))
      .toMatchObject({ key: "delayed", hours: 26 });
  });

  test("a callback that came due counts the hours it is overdue", () => {
    const s = situationOf(
      row({ bucket: "act_now", reason_codes: ["callback_due"], next_action_at: new Date(NOW - 2 * 3600e3).toISOString() }),
      NOW,
    );
    expect(s).toMatchObject({ key: "due", hours: 2 });
  });

  test("waiting on the customer counts down to the callback and quotes the agent's note", () => {
    const s = situationOf(
      row({ bucket: "waiting_customer", next_action_at: new Date(NOW + 3 * 3600e3).toISOString(), last_action_note: "après 15 h" }),
      NOW,
    );
    expect(s).toMatchObject({ key: "waiting_customer", tone: "blue", hours: 3, sub: { text: "après 15 h" } });
    expect(situationOf(row({ bucket: "waiting_customer", next_action_at: new Date(NOW + 3600e3).toISOString() }), NOW).sub)
      .toEqual({ key: "wait_callback" });
  });

  test("waiting on the carrier distinguishes the warehouse from the road", () => {
    expect(situationOf(row({ status: "scanned" }), NOW)).toMatchObject({ key: "at_warehouse", sub: { key: "at_warehouse" } });
    expect(situationOf(row({ status: "out_for_delivery" }), NOW)).toMatchObject({ key: "waiting_carrier", sub: { key: "transit" } });
    expect(situationOf(row({ status: "at_carrier" }), NOW).sub).toEqual({ key: "at_carrier" });
  });

  test("returning and done carry no duration", () => {
    expect(situationOf(row({ bucket: "returning", status: "returning" }), NOW)).toMatchObject({ key: "returning", tone: "red", hours: null });
    expect(situationOf(row({ bucket: "returning", status: "to_be_returned" }), NOW)).toMatchObject({ key: "to_be_returned" });
    expect(situationOf(row({ bucket: "done", status: "delivered" }), NOW)).toMatchObject({ key: "delivered", tone: "green", hours: null });
    expect(situationOf(row({ bucket: "done", status: "returned" }), NOW)).toMatchObject({ key: "returned", tone: "grey" });
  });
});

describe("moveFor", () => {
  test("returning: save the return by calling the branch", () => {
    expect(moveFor(row({ bucket: "returning", status: "returning" }), NOW))
      .toEqual({ kind: "save", dial: "0917710099", actionType: "call_branch", whatsapp: false });
  });

  test("no answer with a second number: call that number", () => {
    expect(moveFor(row({ bucket: "act_now", remark_class: "no_answer", customer_phone_2: "0921122334", reason_codes: ["remark:no_answer"] }), NOW))
      .toEqual({ kind: "call2", dial: "0921122334", actionType: "call_customer", whatsapp: false });
  });

  test("an open task is a call before the courier arrives", () => {
    expect(moveFor(row({ bucket: "act_now", has_open_task: true, reason_codes: ["proactive"] }), NOW).kind).toBe("before");
  });

  test("stalled or delayed without a remark: call the courier", () => {
    expect(moveFor(row({ bucket: "act_now", reason_codes: ["stalled:5"] }), NOW))
      .toEqual({ kind: "courier", dial: "0912345678", actionType: "call_courier", whatsapp: false });
  });

  test("WhatsApp moves open WhatsApp, not the call log", () => {
    expect(moveFor(row({ bucket: "act_now", remark_class: "out_of_coverage", reason_codes: ["remark:out_of_coverage"] }), NOW))
      .toEqual({ kind: "wa", dial: null, actionType: null, whatsapp: true });
  });

  test("waiting states: call the customer, follow the parcel, or just look", () => {
    expect(moveFor(row({ bucket: "waiting_customer", next_action_at: new Date(NOW + 3600e3).toISOString() }), NOW).kind).toBe("call");
    expect(moveFor(row({ status: "out_for_delivery" }), NOW)).toEqual({ kind: "track", dial: null, actionType: null, whatsapp: false });
    expect(moveFor(row({ status: "uploaded" }), NOW).kind).toBe("details");
    expect(moveFor(row({ bucket: "done", status: "delivered" }), NOW).kind).toBe("details");
  });
});

describe("formatPhone", () => {
  test("groups a Libyan number 3-3-4 and leaves anything else alone", () => {
    expect(formatPhone("0921122334")).toBe("092 112 2334");
    expect(formatPhone("22123456")).toBe("22123456");
    expect(formatPhone(null)).toBe("");
  });
});

describe("dayPart", () => {
  test("today, yesterday or a date, on the market clock", () => {
    // 10:30 UTC is 12:30 in Tripoli.
    expect(dayPart("2026-09-13T07:12:00Z", NOW, "Africa/Tripoli")).toEqual({ day: "today", time: "09:12" });
    expect(dayPart("2026-09-12T12:20:00Z", NOW, "Africa/Tripoli")).toEqual({ day: "yesterday", time: "14:20" });
    expect(dayPart("2026-09-10T12:20:00Z", NOW, "Africa/Tripoli")).toEqual({ day: "date", time: "14:20" });
    // 22:30 UTC on the 12th is already the 13th in Tripoli.
    expect(dayPart("2026-09-12T22:30:00Z", NOW, "Africa/Tripoli")).toEqual({ day: "today", time: "00:30" });
  });
});

describe("orderRef", () => {
  test("the tracking number the agent reads on the sticker, else a short id — never a 24-char hash", () => {
    expect(orderRef(row({ tracking_number: "1830773", external_id: "6a90c3c87cdc4cd3eac5178b" }))).toBe("1830773");
    expect(orderRef(row({ tracking_number: null, external_id: "6a90c3c87cdc4cd3eac5178b" }))).toBe("6A90C3C8");
    expect(orderRef(row({ tracking_number: null, external_id: "48211" }))).toBe("48211");
  });
});

describe("moveTone", () => {
  test("the action button borrows the urgency of its move: red to save a return, amber to reach a customer now, grey otherwise", () => {
    expect(moveTone(row({ bucket: "returning", status: "returning" }), NOW)).toBe("red");
    expect(moveTone(row({ bucket: "act_now", reason_codes: ["proactive"], has_open_task: true }), NOW)).toBe("amber");
    expect(moveTone(row({ bucket: "act_now", remark_class: "no_answer", customer_phone_2: "0921122334", reason_codes: ["remark:no_answer"] }), NOW)).toBe("amber");
    // Calling the courier is the carrier's problem, not the customer's: no urgency colour.
    expect(moveTone(row({ bucket: "act_now", reason_codes: ["stalled:5"] }), NOW)).toBe("grey");
    expect(moveTone(row({ bucket: "waiting_customer", next_action_at: new Date(NOW + 3600e3).toISOString() }), NOW)).toBe("grey");
    expect(moveTone(row({ status: "out_for_delivery" }), NOW)).toBe("grey");
    expect(moveTone(row({ bucket: "act_now", remark_class: "out_of_coverage", reason_codes: ["remark:out_of_coverage"] }), NOW)).toBe("green");
  });
});

describe("quickOutcomesFor", () => {
  test("a customer call offers the four outcomes the panel records in one tap, each with its reminder", () => {
    const q = quickOutcomesFor(moveFor(row({ bucket: "act_now", reason_codes: ["remark:no_answer"], remark_class: "no_answer", customer_phone_2: "0921122334" }), NOW));
    expect(q.map((o) => o.outcome)).toEqual(["reached_will_receive", "no_answer", "reached_reschedule", "reached_wants_cancel"]);
    expect(q.map((o) => o.tone)).toEqual(["green", "grey", "blue", "red"]);
    expect(q.find((o) => o.outcome === "no_answer")?.reminder).toBe("in2h");
    expect(q.find((o) => o.outcome === "reached_wants_cancel")?.reminder).toBe("none");
    expect(q.every((o) => o.actionType === "call_customer")).toBe(true);
  });

  test("a call to the courier or the branch offers the carrier outcomes instead", () => {
    const branch = quickOutcomesFor(moveFor(row({ bucket: "returning", status: "returning" }), NOW));
    expect(branch.map((o) => o.outcome)).toEqual(["reattempt_promised", "courier_no_answer", "parcel_located", "return_confirmed"]);
    expect(branch.every((o) => o.actionType === "call_branch")).toBe(true);
    const courier = quickOutcomesFor(moveFor(row({ bucket: "act_now", reason_codes: ["stalled:5"] }), NOW));
    expect(courier.every((o) => o.actionType === "call_courier")).toBe(true);
  });

  test("WhatsApp, tracking and finished parcels have nothing to record in one tap", () => {
    expect(quickOutcomesFor(moveFor(row({ bucket: "act_now", remark_class: "out_of_coverage", reason_codes: ["remark:out_of_coverage"] }), NOW))).toEqual([]);
    expect(quickOutcomesFor(moveFor(row({ status: "out_for_delivery" }), NOW))).toEqual([]);
    expect(quickOutcomesFor(moveFor(row({ bucket: "done", status: "delivered" }), NOW))).toEqual([]);
  });
});
