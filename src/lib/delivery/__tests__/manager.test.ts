import { describe, test, expect } from "vitest";
import { bucketTiles, lastTrace, ringOf, sortRows, stateRows, todoLines, LATE_COURIER_MIN } from "../manager";
import { agentBoard } from "../board";
import type { WorklistRow } from "../types";

const NOW = Date.parse("2026-09-15T10:30:00+02:00");
const TZ = "Africa/Tripoli";
const H = 3_600_000;
const ago = (h: number) => new Date(NOW - h * H).toISOString();

function row(over: Partial<WorklistRow> = {}): WorklistRow {
  return {
    order_id: "o1", external_id: "48211", status: "out_for_delivery", bucket: "act_now",
    reason_codes: ["remark:no_answer"], hours_on_status: 9, next_action_at: null, is_risky: false, risk_reasons: [],
    total_price: 199, customer_name: "Client", customer_phone: "0944764066", customer_phone_2: null,
    customer_city: "Benghazi", customer_address: null, assigned_to: "a1", agent_name: "Amira",
    tracking_number: "2159871", carrier_id: "c1", carrier_status_slug: null, latest_remark: null,
    latest_remark_at: null, remark_class: "no_answer", delayed_until: null, resend_count: 0,
    handler_name: null, handler_phone: null, handler_account_name: null, handler_account_phone: null,
    to_branch_group: null, latest_event_at: ago(9), customer_orders_count: 1, customer_delivered_count: 0,
    customer_returned_count: 0, customer_rejected_count: 0, customer_risk_class: "none",
    last_action_at: null, last_action_type: null, last_action_outcome: null, last_action_note: null,
    has_open_task: false, terminal_at: null, created_at: ago(40), carrier_name: "Darb", items: [],
    ...over,
  };
}

/** A parcel the carrier abandoned a month ago: only the stall code, no fresh remark. */
const dead = (id: string, over: Partial<WorklistRow> = {}) =>
  row({ order_id: id, reason_codes: ["stalled:5"], remark_class: null, hours_on_status: 30 * 24, latest_event_at: ago(30 * 24), ...over });

describe("list states", () => {
  const late = row({ order_id: "late" });
  const fresh = row({ order_id: "fresh", hours_on_status: 1, latest_event_at: ago(1) });
  const stall = dead("stall");
  const done = row({ order_id: "done", bucket: "done", status: "delivered" });
  const all = [late, fresh, stall, done];

  test("« En cours » is every parcel in flight except the long-dead stalls", () => {
    expect(stateRows(all, "live", 4, NOW).map((r) => r.order_id)).toEqual(["late", "fresh"]);
  });
  test("« En retard » is past the target with no action since its reason appeared", () => {
    expect(stateRows(all, "late", 4, NOW).map((r) => r.order_id)).toEqual(["late"]);
  });
  test("« Sans mouvement » holds the stalls set aside", () => {
    expect(stateRows(all, "stalled", 4, NOW).map((r) => r.order_id)).toEqual(["stall"]);
  });
  test("« Terminées » holds the delivered and returned", () => {
    expect(stateRows(all, "done", 4, NOW).map((r) => r.order_id)).toEqual(["done"]);
  });
});

describe("the agent's ring: treated today out of what needed her today", () => {
  test("counts parcels acted on today, plus the live ones still waiting", () => {
    const rows = [
      row({ order_id: "a", last_action_at: ago(1), latest_event_at: ago(5) }),
      row({ order_id: "b", bucket: "waiting_customer", last_action_at: ago(2) }),
      row({ order_id: "c" }),
      row({ order_id: "d", last_action_at: ago(30) }),
      row({ order_id: "e", assigned_to: "a2" }),
    ];
    expect(ringOf(rows, "a1", TZ, NOW)).toEqual({ treated: 2, total: 4 });
  });

  test("a stall nobody can act on never counts against her", () => {
    expect(ringOf([dead("x")], "a1", TZ, NOW)).toEqual({ treated: 0, total: 0 });
  });

  test("yesterday evening is not today on the market clock", () => {
    const lastNight = new Date(Date.parse("2026-09-14T23:30:00+02:00")).toISOString();
    expect(ringOf([row({ last_action_at: lastNight, bucket: "waiting_customer" })], "a1", TZ, NOW).treated).toBe(0);
  });
});

describe("todo lines", () => {
  const amira = { id: "a1", name: "Amira" };
  const hiba = { id: "a2", name: "Hiba" };
  const boardsOf = (rows: WorklistRow[], actions: Record<string, number>) =>
    [amira, hiba].map((a) => agentBoard(rows, a, { agent_id: a.id, actions_today: actions[a.id] ?? 0, reached_today: 0, whatsapp_today: 0, saved_week: 0, lost_week: 0, week: [0, 0, 0, 0, 0, 0, 0] }, 4, NOW));

  test("names who holds the late parcels, most first", () => {
    const rows = [row({ order_id: "1" }), row({ order_id: "2" }), row({ order_id: "3", assigned_to: "a2", agent_name: "Hiba" })];
    const lines = todoLines(rows, boardsOf(rows, { a1: 1, a2: 1 }), 4, NOW);
    expect(lines[0]).toEqual({ kind: "late", n: 3, by: [{ id: "a1", name: "Amira", n: 2 }, { id: "a2", name: "Hiba", n: 1 }] });
  });

  test("an idle agent gets a line offering to move all she holds", () => {
    const rows = [row({ order_id: "1", assigned_to: "a2", hours_on_status: 1, latest_event_at: ago(1) }), row({ order_id: "2", assigned_to: "a2", bucket: "waiting_carrier" })];
    const lines = todoLines(rows, boardsOf(rows, {}), 4, NOW);
    expect(lines).toContainEqual({ kind: "idle", id: "a2", name: "Hiba", toTreat: 1, inFlight: 2 });
  });

  test("parcels in flight with no agent are listed for assignment", () => {
    const rows = [row({ order_id: "n1", assigned_to: null, agent_name: null, bucket: "returning" })];
    expect(todoLines(rows, boardsOf(rows, {}), 4, NOW)).toContainEqual({ kind: "none", ids: ["n1"] });
  });

  test(`a courier holding ${LATE_COURIER_MIN}+ unreachable customers is one call to make`, () => {
    const rows = Array.from({ length: LATE_COURIER_MIN }, (_, i) =>
      row({ order_id: `c${i}`, handler_name: "Adel", handler_phone: "0911", hours_on_status: 1, latest_event_at: ago(1) }));
    expect(todoLines(rows, boardsOf(rows, { a1: 1 }), 4, NOW)).toContainEqual({ kind: "courier", name: "Adel", phone: "0911", n: LATE_COURIER_MIN });
  });

  test("the stalls come last, as a quiet line", () => {
    const rows = [dead("s1"), dead("s2"), row({ order_id: "1" })];
    const lines = todoLines(rows, boardsOf(rows, { a1: 1 }), 4, NOW);
    expect(lines[lines.length - 1]).toEqual({ kind: "stall", n: 2 });
  });

  test("a calm market has no lines", () => {
    const rows = [row({ hours_on_status: 1, latest_event_at: ago(1) })];
    expect(todoLines(rows, boardsOf(rows, { a1: 3 }), 4, NOW)).toEqual([]);
  });
});

describe("bucket tiles", () => {
  test("count, amount, situation split and late count, stalls excluded", () => {
    const rows = [
      row({ order_id: "1", total_price: 100 }),
      row({ order_id: "2", total_price: 50, reason_codes: ["delayed"], remark_class: null, hours_on_status: 1, latest_event_at: ago(1) }),
      dead("3"),
      row({ order_id: "4", bucket: "returning", status: "returning", total_price: 70 }),
    ];
    const tiles = bucketTiles(rows, 4, NOW);
    expect(tiles.map((t) => t.bucket)).toEqual(["returning", "act_now", "waiting_customer", "waiting_carrier"]);
    const act = tiles[1];
    expect(act).toMatchObject({ count: 2, amount: 150, late: 1 });
    expect(act.segments).toEqual([{ key: "no_answer", count: 1 }, { key: "delayed", count: 1 }]);
    expect(tiles[0]).toMatchObject({ count: 1, amount: 70, late: 0 });
  });
});

describe("the row's last trace", () => {
  test("the agent's action when it is newer than the courier's words", () => {
    const r = row({ last_action_at: ago(1), last_action_type: "call_customer", latest_remark: "لا يرد", latest_remark_at: ago(3) });
    expect(lastTrace(r)).toEqual({ kind: "action", at: ago(1) });
  });
  test("the courier's words when they came after", () => {
    const r = row({ last_action_at: ago(5), last_action_type: "call_customer", latest_remark: "لا يرد", latest_remark_at: ago(3) });
    expect(lastTrace(r)).toEqual({ kind: "remark", at: ago(3), text: "لا يرد" });
  });
  test("nothing when nobody has spoken", () => {
    expect(lastTrace(row())).toBeNull();
  });
});

describe("sorting", () => {
  const a = row({ order_id: "a", bucket: "waiting_carrier", hours_on_status: 50, total_price: 10 });
  const b = row({ order_id: "b", bucket: "returning", hours_on_status: 2, total_price: 300 });
  const late = row({ order_id: "late", hours_on_status: 9, total_price: 20 });
  test("priority puts late parcels first, then by bucket", () => {
    expect(sortRows([a, b, late], "priority", 4, NOW).map((r) => r.order_id)).toEqual(["late", "b", "a"]);
  });
  test("wait is longest first; amount is largest first", () => {
    expect(sortRows([b, late, a], "wait", 4, NOW).map((r) => r.order_id)).toEqual(["a", "late", "b"]);
    expect(sortRows([a, late, b], "amount", 4, NOW).map((r) => r.order_id)).toEqual(["b", "late", "a"]);
  });
});
