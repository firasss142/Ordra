import { describe, test, expect } from "vitest";
import {
  BUCKET_ORDER,
  countBuckets,
  groupByBucket,
  nextMove,
  reasonChips,
  applyRecordedAction,
  shouldRefreshWorklist,
} from "../worklist";
import type { WorklistRow } from "../types";

const NOW = Date.parse("2026-09-13T10:00:00Z");

function row(over: Partial<WorklistRow> = {}): WorklistRow {
  return {
    order_id: "o1",
    external_id: "48211",
    status: "in_transit",
    bucket: "waiting_carrier",
    reason_codes: [],
    hours_on_status: 5,
    next_action_at: null,
    is_risky: false,
    risk_reasons: [],
    total_price: 185,
    customer_name: "هدى",
    customer_phone: "0913322110",
    customer_phone_2: null,
    customer_city: "طرابلس",
    customer_address: "عين زارة",
    assigned_to: "a1",
    agent_name: "Tasnim",
    tracking_number: "T1",
    carrier_id: "c1",
    carrier_status_slug: null,
    latest_remark: null,
    latest_remark_at: null,
    remark_class: null,
    delayed_until: null,
    resend_count: 0,
    handler_name: null,
    handler_phone: null,
    handler_account_name: null,
    handler_account_phone: null,
    to_branch_group: null,
    latest_event_at: null,
    customer_orders_count: 1,
    customer_delivered_count: 0,
    customer_returned_count: 0,
    customer_rejected_count: 0,
    customer_risk_class: "repeat",
    last_action_at: null,
    last_action_type: null,
    last_action_outcome: null,
    last_action_note: null,
    has_open_task: false,
    terminal_at: null,
    created_at: "2026-09-12T08:00:00Z",
    carrier_name: "Darb Assabil",
    items: [],
    ...over,
  };
}

describe("buckets", () => {
  test("the order is the owner's priority", () => {
    expect(BUCKET_ORDER).toEqual(["returning", "act_now", "waiting_customer", "waiting_carrier", "done"]);
  });

  test("counts every bucket, zero included", () => {
    const rows = [row({ bucket: "act_now" }), row({ bucket: "act_now" }), row({ bucket: "done" })];
    expect(countBuckets(rows)).toEqual({
      all: 3,
      returning: 0,
      act_now: 2,
      waiting_customer: 0,
      waiting_carrier: 0,
      done: 1,
    });
  });

  test("groups keep the server's order inside each bucket", () => {
    const rows = [
      row({ order_id: "a", bucket: "waiting_carrier" }),
      row({ order_id: "b", bucket: "act_now" }),
      row({ order_id: "c", bucket: "act_now" }),
    ];
    const g = groupByBucket(rows);
    expect(g.act_now.map((r) => r.order_id)).toEqual(["b", "c"]);
    expect(g.waiting_carrier.map((r) => r.order_id)).toEqual(["a"]);
    expect(g.returning).toEqual([]);
  });
});

describe("nextMove", () => {
  test("returning parcels: call the branch", () => {
    expect(nextMove(row({ bucket: "returning", status: "returning" }), NOW).kind).toBe("call_branch");
  });

  test("an open proactive task: call the customer before the courier arrives", () => {
    expect(nextMove(row({ bucket: "act_now", has_open_task: true, reason_codes: ["proactive"] }), NOW).kind).toBe(
      "call_customer",
    );
  });

  test("stalled: ask the courier where it is", () => {
    expect(nextMove(row({ bucket: "act_now", reason_codes: ["stalled:5"] }), NOW).kind).toBe("call_courier");
  });

  test("no answer: try the second number, else WhatsApp", () => {
    const withTwo = row({ bucket: "act_now", remark_class: "no_answer", customer_phone_2: "0925511200", reason_codes: ["remark:no_answer"] });
    expect(nextMove(withTwo, NOW)).toMatchObject({ kind: "call_second", phone: "0925511200" });
    const withOne = row({ bucket: "act_now", remark_class: "no_answer", reason_codes: ["remark:no_answer"] });
    expect(nextMove(withOne, NOW).kind).toBe("whatsapp");
  });

  test("out of coverage: WhatsApp, a call cannot reach them", () => {
    expect(
      nextMove(row({ bucket: "act_now", remark_class: "out_of_coverage", reason_codes: ["remark:out_of_coverage"] }), NOW).kind,
    ).toBe("whatsapp");
  });

  test("waiting on the customer carries the time left", () => {
    const m = nextMove(
      row({ bucket: "waiting_customer", next_action_at: new Date(NOW + 3 * 3600e3).toISOString() }),
      NOW,
    );
    expect(m).toMatchObject({ kind: "wait_customer", hoursLeft: 3 });
  });

  test("waiting on the carrier: at the warehouse is its own message", () => {
    expect(nextMove(row({ bucket: "waiting_carrier", status: "scanned" }), NOW).kind).toBe("at_warehouse");
    expect(nextMove(row({ bucket: "waiting_carrier", status: "in_transit" }), NOW).kind).toBe("wait_carrier");
  });

  test("done: nothing", () => {
    expect(nextMove(row({ bucket: "done", status: "delivered" }), NOW).kind).toBe("none");
  });
});

describe("reasonChips", () => {
  test("turns server codes into typed chips, days parsed", () => {
    expect(
      reasonChips(row({ reason_codes: ["proactive", "remark:no_answer", "stalled:5", "callback_due"] })),
    ).toEqual([
      { kind: "proactive" },
      { kind: "remark", remarkClass: "no_answer" },
      { kind: "stalled", days: 5 },
      { kind: "callback_due" },
    ]);
  });

  test("at_warehouse is not a problem and gets no chip", () => {
    expect(reasonChips(row({ reason_codes: ["at_warehouse"] }))).toEqual([]);
  });

  test("risk reasons follow an open proactive task", () => {
    expect(
      reasonChips(row({ reason_codes: ["proactive"], has_open_task: true, risk_reasons: ["high_value"] })),
    ).toEqual([{ kind: "proactive" }, { kind: "risk", reason: "high_value" }]);
  });
});

describe("applyRecordedAction", () => {
  test("a scheduled next step moves an act-now parcel to waiting on the customer", () => {
    const next = new Date(NOW + 2 * 3600e3).toISOString();
    const r = applyRecordedAction(
      row({ bucket: "act_now", has_open_task: true, reason_codes: ["proactive", "remark:no_answer"] }),
      { action_type: "call_customer", outcome: "reached_reschedule", note: "jeudi", next_action_at: next },
      NOW,
    );
    expect(r.bucket).toBe("waiting_customer");
    expect(r.next_action_at).toBe(next);
    expect(r.has_open_task).toBe(false);
    expect(r.reason_codes).toEqual([]);
    expect(r.last_action_outcome).toBe("reached_reschedule");
  });

  test("without a next step it falls back to waiting on the carrier", () => {
    const r = applyRecordedAction(
      row({ bucket: "act_now", reason_codes: ["remark:no_answer"] }),
      { action_type: "call_courier", outcome: "reattempt_promised", note: null, next_action_at: null },
      NOW,
    );
    expect(r.bucket).toBe("waiting_carrier");
  });

  test("returning and done parcels keep their bucket: an action does not un-return a parcel", () => {
    const r = applyRecordedAction(
      row({ bucket: "returning", status: "returning", reason_codes: ["returning"] }),
      { action_type: "call_branch", outcome: "reattempt_promised", note: null, next_action_at: null },
      NOW,
    );
    expect(r.bucket).toBe("returning");
    expect(r.reason_codes).toEqual(["returning"]);
  });

  test("stall is the carrier's problem, not answered by a call: it stays", () => {
    const r = applyRecordedAction(
      row({ bucket: "act_now", reason_codes: ["stalled:5"] }),
      { action_type: "call_courier", outcome: "parcel_located", note: null, next_action_at: null },
      NOW,
    );
    expect(r.bucket).toBe("act_now");
  });
});

describe("shouldRefreshWorklist", () => {
  const held = [row({ order_id: "o1", status: "in_transit" })];
  const evt = (over: Record<string, unknown>) =>
    ({ op: "UPDATE", id: "o1", market_id: "m", status: "in_transit", assigned_to: "a1", archived_at: null, updated_at: "x", ...over }) as never;

  test("a parcel on the list changing status refreshes", () => {
    expect(shouldRefreshWorklist(evt({ status: "delivered" }), held, "a1", "agent")).toBe(true);
  });

  test("the Darb sync touching a parcel without moving it does not — it writes all day", () => {
    expect(shouldRefreshWorklist(evt({}), held, "a1", "agent")).toBe(false);
  });

  test("an agent's own order entering the post-upload world appears; someone else's does not", () => {
    expect(shouldRefreshWorklist(evt({ id: "o9", status: "uploaded" }), held, "a1", "agent")).toBe(true);
    expect(shouldRefreshWorklist(evt({ id: "o9", status: "uploaded", assigned_to: "a2" }), held, "a1", "agent")).toBe(false);
    expect(shouldRefreshWorklist(evt({ id: "o9", status: "confirmed" }), held, "a1", "agent")).toBe(false);
  });

  test("managers watch the whole market, so any order reaching upload counts", () => {
    expect(shouldRefreshWorklist(evt({ id: "o9", status: "uploaded", assigned_to: "a2" }), held, "m1", "market_manager")).toBe(true);
  });

  test("a held parcel deleted or archived leaves the list", () => {
    expect(shouldRefreshWorklist(evt({ op: "DELETE" }), held, "a1", "agent")).toBe(true);
    expect(shouldRefreshWorklist(evt({ archived_at: "2026-09-13T00:00:00Z" }), held, "a1", "agent")).toBe(true);
  });
});
