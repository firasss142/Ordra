import { describe, it, expect } from "vitest";
import type { WorklistRow } from "@/lib/delivery/types";
import { actOf, filterParcels, journalKind, relOf, sinceMinutes, sitOf, stallRange, SIT_ORDER } from "../agent-view";

const NOW = Date.parse("2026-09-13T10:30:00Z");

function row(over: Partial<WorklistRow>): WorklistRow {
  return {
    order_id: "o1", external_id: "48211", status: "out_for_delivery", bucket: "act_now",
    reason_codes: ["remark:no_answer"], hours_on_status: 5, next_action_at: null, is_risky: false, risk_reasons: [],
    total_price: 185, customer_name: "Amina", customer_phone: "0914456677", customer_phone_2: "0921122334",
    customer_city: "Tripoli", customer_address: "Aïn Zara", assigned_to: "a1", agent_name: null,
    tracking_number: "5501", carrier_id: "c1", carrier_status_slug: null, latest_remark: null,
    latest_remark_at: null, remark_class: "no_answer", delayed_until: null, resend_count: 0,
    handler_name: "Ali", handler_phone: "0912345678", handler_account_name: null, handler_account_phone: "0917710099",
    to_branch_group: null, latest_event_at: null, customer_orders_count: 1, customer_delivered_count: 0,
    customer_returned_count: 0, customer_rejected_count: 0, customer_risk_class: null,
    last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null,
    has_open_task: false, terminal_at: null, created_at: "2026-09-12T08:00:00Z", carrier_name: "Darb Assabil",
    items: [],
    ...over,
  };
}

describe("sitOf — the prototype's situations (SIT) read from a live row", () => {
  it.each([
    [{ bucket: "returning", status: "returning", reason_codes: ["returning"] }, "ret"],
    [{ bucket: "returning", status: "to_be_returned", reason_codes: ["returning"] }, "ret"],
    [{ reason_codes: ["proactive"], remark_class: null }, "risk"],
    [{ reason_codes: ["remark:customer_cancelled"], remark_class: "customer_cancelled" }, "cancel"],
    [{ reason_codes: ["remark:no_answer"] }, "unreach"],
    [{ reason_codes: ["remark:out_of_coverage"], remark_class: "out_of_coverage" }, "offnet"],
    [{ reason_codes: ["remark:wrong_address"], remark_class: "wrong_address" }, "address"],
    [{ reason_codes: ["delayed"], remark_class: null }, "delayed"],
    [{ reason_codes: ["callback_due"], remark_class: null }, "cbdue"],
    [{ reason_codes: ["stalled:5"], remark_class: null }, "stall"],
    [{ bucket: "waiting_customer", reason_codes: [] }, "wait"],
    [{ bucket: "waiting_carrier", status: "uploaded", reason_codes: ["at_warehouse"] }, "depot"],
    [{ bucket: "waiting_carrier", status: "in_transit", reason_codes: [] }, "carrier"],
    [{ bucket: "waiting_carrier", status: "out_for_delivery", reason_codes: [] }, "ofd"],
    [{ bucket: "done", status: "delivered", reason_codes: [] }, "delivered"],
    [{ bucket: "done", status: "returned", reason_codes: [] }, "retdone"],
  ] as [Partial<WorklistRow>, string][])("%o → %s", (over, sit) => {
    expect(sitOf(row(over), NOW)).toBe(sit);
  });
});

describe("actOf — the move, and the number INSIDE the button (decision 2026-09-17)", () => {
  it("a customer the courier could not reach: call the 2nd number", () => {
    expect(actOf(row({}), NOW)).toMatchObject({ key: "call2", num: "0921122334", wa: false, actionType: "call_customer" });
  });
  it("a return: save it through the Darb account's number", () => {
    const a = actOf(row({ bucket: "returning", status: "returning", reason_codes: ["returning"], handler_phone: null }), NOW);
    expect(a).toMatchObject({ key: "save", num: "0917710099", actionType: "call_branch" });
  });
  it("a parcel out for delivery: call the customer before the courier passes", () => {
    const a = actOf(row({ bucket: "waiting_carrier", status: "out_for_delivery", reason_codes: [], remark_class: null }), NOW);
    expect(a).toMatchObject({ key: "before", num: "0914456677", actionType: "call_customer" });
  });
  it("a risky customer: call before delivery", () => {
    expect(actOf(row({ reason_codes: ["proactive"], remark_class: null }), NOW)).toMatchObject({ key: "before", num: "0914456677" });
  });
  it("out of coverage with no second number: WhatsApp, no number", () => {
    const a = actOf(row({ reason_codes: ["remark:out_of_coverage"], remark_class: "out_of_coverage" }), NOW);
    expect(a).toMatchObject({ key: "wa", num: null, wa: true });
  });
  it("in transit: follow the parcel, nothing to dial", () => {
    expect(actOf(row({ bucket: "waiting_carrier", status: "in_transit", reason_codes: [], remark_class: null }), NOW)).toMatchObject({ key: "track", num: null });
  });
  it("delivered: see the details", () => {
    expect(actOf(row({ bucket: "done", status: "delivered", reason_codes: [] }), NOW)).toMatchObject({ key: "details", num: null });
  });
});

describe("sinceMinutes", () => {
  it("is the time on the current status", () => {
    expect(sinceMinutes(row({ hours_on_status: 5 }), NOW)).toBe(300);
  });
  it("a missed callback counts from the promised time", () => {
    const r = row({ reason_codes: ["callback_due"], remark_class: null, next_action_at: "2026-09-13T08:30:00Z", hours_on_status: 40 });
    expect(sinceMinutes(r, NOW)).toBe(120);
  });
});

describe("filterParcels — tiles, search, risk filter and the three sorts", () => {
  const ret = row({ order_id: "r", bucket: "returning", status: "returning", reason_codes: ["returning"], total_price: 50, created_at: "2026-09-01T00:00:00Z" });
  const unreach = row({ order_id: "u", total_price: 300, hours_on_status: 2 });
  const delayed = row({ order_id: "d", reason_codes: ["delayed"], remark_class: null, total_price: 100, is_risky: true, created_at: "2026-09-10T00:00:00Z" });
  const done = row({ order_id: "x", bucket: "done", status: "delivered", reason_codes: [], customer_name: "Tarek" });
  const all = [delayed, done, unreach, ret];
  const ids = (rs: WorklistRow[]) => rs.map((r) => r.order_id);
  const base = { bucket: "all" as const, q: "", risk: false, sort: "prio" as const };

  it("« Tout » leaves the finished parcels out; the priority sort follows the situations", () => {
    expect(ids(filterParcels(all, base, NOW))).toEqual(["r", "u", "d"]);
  });
  it("a tile shows its bucket only", () => {
    expect(ids(filterParcels(all, { ...base, bucket: "done" }, NOW))).toEqual(["x"]);
  });
  it("by amount, then by oldest", () => {
    expect(ids(filterParcels(all, { ...base, sort: "amt" }, NOW))).toEqual(["u", "d", "r"]);
    expect(ids(filterParcels(all, { ...base, sort: "old" }, NOW))).toEqual(["r", "d", "u"]);
  });
  it("« Colis à risque seulement »", () => {
    expect(ids(filterParcels(all, { ...base, risk: true }, NOW))).toEqual(["d"]);
  });
  it("searches name, tracking number and phone digits", () => {
    expect(ids(filterParcels(all, { ...base, bucket: "done", q: "tarek" }, NOW))).toEqual(["x"]);
    expect(ids(filterParcels([unreach], { ...base, q: "092 112" }, NOW))).toEqual(["u"]);
    expect(ids(filterParcels([unreach], { ...base, q: "zzz" }, NOW))).toEqual([]);
  });
  it("SIT_ORDER starts with the returns and ends with the finished", () => {
    expect(SIT_ORDER[0]).toBe("ret");
    expect(SIT_ORDER.at(-1)).toBe("retdone");
  });
});

describe("relOf — the customer chip", () => {
  it("first order", () => expect(relOf(row({ customer_orders_count: 1 }))).toEqual({ kind: "new", hue: "neutral", n: 1, del: 0, bad: 0 }));
  it("reliable", () => expect(relOf(row({ customer_orders_count: 3, customer_delivered_count: 2 }))).toMatchObject({ kind: "reliable", hue: "green", n: 3, del: 2 }));
  it("at risk", () => expect(relOf(row({ customer_orders_count: 4, customer_returned_count: 1, customer_rejected_count: 2 }))).toMatchObject({ kind: "risk", hue: "red", bad: 3 }));
  it("middling", () => expect(relOf(row({ customer_orders_count: 3, customer_delivered_count: 1, customer_returned_count: 1 }))).toMatchObject({ kind: "mid", hue: "amber" }));
});

describe("journal and the stalled fold", () => {
  it("actions, the carrier (events + courier words), and the system", () => {
    expect(journalKind("action")).toBe("act");
    expect(journalKind("carrier")).toBe("car");
    expect(journalKind("remark")).toBe("car");
    expect(journalKind("order")).toBe("sys");
  });
  it("stallRange gives the youngest and the oldest stall in days", () => {
    expect(stallRange([row({ hours_on_status: 24 * 30 }), row({ hours_on_status: 24 * 85 + 3 })])).toEqual({ min: 30, max: 85 });
  });
});
