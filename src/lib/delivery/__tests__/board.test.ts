import { describe, test, expect } from "vitest";
import { agentBoard, courierBoard, marketSummary, verdictOf, worstParcels, agentLoad, DEFAULT_TARGET_HOURS, type AgentActivity } from "../board";
import type { WorklistRow } from "../types";

const NOW = Date.parse("2026-09-15T10:30:00+02:00");
const H = 3_600_000;
const ago = (h: number) => new Date(NOW - h * H).toISOString();

function row(over: Partial<WorklistRow> = {}): WorklistRow {
  return {
    order_id: "o1",
    external_id: "48211",
    status: "out_for_delivery",
    bucket: "act_now",
    reason_codes: ["remark:no_answer"],
    hours_on_status: 9,
    next_action_at: null,
    is_risky: false,
    risk_reasons: [],
    total_price: 199,
    customer_name: "احمد فرج",
    customer_phone: "0944764066",
    customer_phone_2: null,
    customer_city: "بنغازي",
    customer_address: "سيدي عائشة",
    assigned_to: "a1",
    agent_name: "roqaya",
    tracking_number: "2159871",
    carrier_id: "c1",
    carrier_status_slug: null,
    latest_remark: null,
    latest_remark_at: null,
    remark_class: "no_answer",
    delayed_until: null,
    resend_count: 0,
    handler_name: "رواجع تاجوراء",
    handler_phone: "+218990491301",
    handler_account_name: null,
    handler_account_phone: null,
    to_branch_group: "BN",
    latest_event_at: ago(9),
    customer_orders_count: 1,
    customer_delivered_count: 0,
    customer_returned_count: 0,
    customer_rejected_count: 0,
    customer_risk_class: "none",
    last_action_at: null,
    last_action_type: null,
    last_action_outcome: null,
    last_action_note: null,
    has_open_task: false,
    terminal_at: null,
    created_at: ago(40),
    carrier_name: "Darb Assabil — Benghazi",
    items: [],
    ...over,
  };
}

/** The activity figures the ledger answers for, per agent. */
const activity = (
  over: Partial<{ agent_id: string; actions: number; reached: number; whatsapp: number; saved: number; lost: number; week: number[] }> = {},
): AgentActivity => ({
  agent_id: over.agent_id ?? "a1",
  actions_today: over.actions ?? 0,
  reached_today: over.reached ?? 0,
  whatsapp_today: over.whatsapp ?? 0,
  saved_week: over.saved ?? 0,
  lost_week: over.lost ?? 0,
  week: over.week ?? [0, 0, 0, 0, 0, 0, 0],
});

describe("verdictOf — one judgement per agent, against the target", () => {
  test("a parcel waiting past the target with no action since its reason is late", () => {
    const rows = [row({ hours_on_status: 9, last_action_at: null })];
    expect(verdictOf(rows, activity({ actions: 3 }), DEFAULT_TARGET_HOURS, NOW).verdict).toBe("late");
  });

  test("an action taken after the reason appeared clears the parcel", () => {
    const rows = [row({ hours_on_status: 9, latest_event_at: ago(9), last_action_at: ago(2) })];
    expect(verdictOf(rows, activity({ actions: 1 }), DEFAULT_TARGET_HOURS, NOW).verdict).toBe("ok");
  });

  test("an action older than the reason does not clear it", () => {
    const rows = [row({ hours_on_status: 9, latest_event_at: ago(9), last_action_at: ago(26) })];
    expect(verdictOf(rows, activity({ actions: 1 }), DEFAULT_TARGET_HOURS, NOW).verdict).toBe("late");
  });

  test("a parcel still inside the target is not late", () => {
    const rows = [row({ hours_on_status: 2, last_action_at: null })];
    expect(verdictOf(rows, activity({ actions: 1 }), DEFAULT_TARGET_HOURS, NOW).verdict).toBe("ok");
  });

  test("parcels to treat and nothing logged today reads as idle, not late", () => {
    const rows = [row({ hours_on_status: 2, last_action_at: null })];
    expect(verdictOf(rows, activity({ actions: 0 }), DEFAULT_TARGET_HOURS, NOW).verdict).toBe("idle");
  });

  test("an agent with no live parcel is never idle", () => {
    const rows = [row({ bucket: "waiting_carrier", reason_codes: [] })];
    expect(verdictOf(rows, activity({ actions: 0 }), DEFAULT_TARGET_HOURS, NOW).verdict).toBe("ok");
  });

  test("the target comes from the setting, not from a constant", () => {
    const rows = [row({ hours_on_status: 9, last_action_at: null })];
    expect(verdictOf(rows, activity({ actions: 1 }), 12, NOW).verdict).toBe("ok");
  });

  test("long-dead stalls are not what makes an agent late", () => {
    const rows = [row({ reason_codes: ["stalled:5"], hours_on_status: 2079, latest_event_at: ago(2079), latest_remark_at: ago(2079) })];
    const v = verdictOf(rows, activity({ actions: 1 }), DEFAULT_TARGET_HOURS, NOW);
    expect(v.verdict).toBe("ok");
    expect(v.late).toHaveLength(0);
  });

  test("the reason's clock is the carrier event, falling back to creation", () => {
    const rows = [row({ hours_on_status: 9, latest_event_at: null, created_at: ago(40), last_action_at: ago(20) })];
    expect(verdictOf(rows, activity({ actions: 1 }), DEFAULT_TARGET_HOURS, NOW).verdict).toBe("ok");
  });
});

describe("agentBoard — the three frames of an agent's page", () => {
  const rows = [
    row({ order_id: "1", assigned_to: "a1", hours_on_status: 21, last_action_at: null }),
    row({ order_id: "2", assigned_to: "a1", hours_on_status: 9, last_action_at: null }),
    row({ order_id: "3", assigned_to: "a1", bucket: "returning", reason_codes: ["returning"], status: "returning" }),
    row({ order_id: "4", assigned_to: "a1", bucket: "waiting_carrier", reason_codes: [] }),
    row({ order_id: "5", assigned_to: "a1", bucket: "done", status: "delivered", reason_codes: [], terminal_at: ago(3) }),
    row({ order_id: "6", assigned_to: "a2", agent_name: "hend" }),
  ];

  test("counts only its own agent's parcels", () => {
    const a = agentBoard(rows, { id: "a1", name: "roqaya" }, activity({ actions: 2, reached: 1, whatsapp: 1, saved: 1 }), DEFAULT_TARGET_HOURS, NOW);
    expect(a.toTreat).toBe(2);
    expect(a.returning).toBe(1);
    expect(a.inFlight).toBe(4);
    expect(a.done).toBe(1);
  });

  test("the oldest wait is in hours, and the late count is its own", () => {
    const a = agentBoard(rows, { id: "a1", name: "roqaya" }, activity(), DEFAULT_TARGET_HOURS, NOW);
    expect(a.oldestHours).toBe(21);
    expect(a.lateCount).toBe(2);
  });

  test("today and this week come from the ledger, not from the rows", () => {
    const a = agentBoard(rows, { id: "a1", name: "roqaya" }, activity({ actions: 6, reached: 4, whatsapp: 3, saved: 2, lost: 1 }), DEFAULT_TARGET_HOURS, NOW);
    expect(a.actionsToday).toBe(6);
    expect(a.reachedToday).toBe(4);
    expect(a.whatsappToday).toBe(3);
    expect(a.savedWeek).toBe(2);
    expect(a.lostWeek).toBe(1);
  });

  test("an agent with no activity row still gets zeros, never NaN", () => {
    const a = agentBoard(rows, { id: "a1", name: "roqaya" }, null, DEFAULT_TARGET_HOURS, NOW);
    expect(a.actionsToday).toBe(0);
    expect(a.week).toHaveLength(7);
  });
});

describe("worstParcels — the three that block, late first", () => {
  test("late parcels come first, longest wait first, then the rest by wait", () => {
    const rows = [
      row({ order_id: "short", hours_on_status: 2, last_action_at: null }),
      row({ order_id: "late-9", hours_on_status: 9, last_action_at: null }),
      row({ order_id: "late-21", hours_on_status: 21, last_action_at: null }),
      row({ order_id: "acted", hours_on_status: 30, latest_event_at: ago(30), last_action_at: ago(1) }),
    ];
    const worst = worstParcels(rows, DEFAULT_TARGET_HOURS, NOW);
    expect(worst.map((r) => r.order_id)).toEqual(["late-21", "late-9", "acted"]);
  });

  test("never more than three", () => {
    const rows = Array.from({ length: 6 }, (_, i) => row({ order_id: `o${i}`, hours_on_status: 9 + i }));
    expect(worstParcels(rows, DEFAULT_TARGET_HOURS, NOW)).toHaveLength(3);
  });
});

describe("agentLoad — how an agent's parcels split", () => {
  test("shares are percentages of the live list and exclude terminal parcels", () => {
    const rows = [
      row({ bucket: "returning", reason_codes: ["returning"] }),
      row({ bucket: "act_now" }),
      row({ bucket: "waiting_customer", reason_codes: [], next_action_at: new Date(NOW + 3 * H).toISOString() }),
      row({ bucket: "waiting_carrier", reason_codes: [] }),
      row({ bucket: "done", status: "delivered", reason_codes: [], terminal_at: ago(2) }),
    ];
    const load = agentLoad(rows, NOW);
    expect(load.map((s) => s.bucket)).toEqual(["returning", "act_now", "waiting_customer", "waiting_carrier"]);
    expect(load.every((s) => s.share === 25)).toBe(true);
  });

  test("an empty list produces no segments rather than a division by zero", () => {
    expect(agentLoad([], NOW)).toEqual([]);
  });
});

describe("marketSummary — the all-agents view", () => {
  const rows = [
    row({ order_id: "1", assigned_to: "a1", agent_name: "roqaya", hours_on_status: 21, last_action_at: null }),
    row({ order_id: "2", assigned_to: "a2", agent_name: "hend", hours_on_status: 2, last_action_at: null }),
    row({ order_id: "3", assigned_to: "a3", agent_name: "tasnim", bucket: "waiting_carrier", reason_codes: [] }),
  ];
  const activities = [
    activity({ agent_id: "a1", actions: 1 }),
    activity({ agent_id: "a2", actions: 2 }),
    activity({ agent_id: "a3", actions: 0 }),
  ];

  test("groups agents by verdict and never ranks them", () => {
    const s = marketSummary(rows, [
      { id: "a1", name: "roqaya" }, { id: "a2", name: "hend" }, { id: "a3", name: "tasnim" },
    ], activities, DEFAULT_TARGET_HOURS, NOW);
    expect(s.late.map((a) => a.name)).toEqual(["roqaya"]);
    expect(s.ok.map((a) => a.name)).toEqual(["hend", "tasnim"]);
    expect(s.idle).toHaveLength(0);
  });

  test("agents are alphabetical inside a group, so the order is not a league table", () => {
    const s = marketSummary(
      [row({ assigned_to: "z", agent_name: "zahra", bucket: "waiting_carrier", reason_codes: [] }),
       row({ assigned_to: "a", agent_name: "amal", bucket: "waiting_carrier", reason_codes: [] })],
      [{ id: "z", name: "zahra" }, { id: "a", name: "amal" }],
      [activity({ agent_id: "z" }), activity({ agent_id: "a" })],
      DEFAULT_TARGET_HOURS, NOW,
    );
    expect(s.ok.map((a) => a.name)).toEqual(["amal", "zahra"]);
  });

  test("the market totals count parcels, not agents", () => {
    const s = marketSummary(rows, [
      { id: "a1", name: "roqaya" }, { id: "a2", name: "hend" }, { id: "a3", name: "tasnim" },
    ], activities, DEFAULT_TARGET_HOURS, NOW);
    expect(s.toTreat).toBe(2);
    expect(s.lateParcels).toBe(1);
  });

  test("an agent holding nothing still appears, so a manager sees the whole team", () => {
    const s = marketSummary(rows, [
      { id: "a1", name: "roqaya" }, { id: "a2", name: "hend" }, { id: "a3", name: "tasnim" }, { id: "a4", name: "mouna" },
    ], activities, DEFAULT_TARGET_HOURS, NOW);
    expect([...s.late, ...s.idle, ...s.ok].map((a) => a.name)).toContain("mouna");
  });
});

describe("courierBoard — who holds the parcels now", () => {
  test("groups live parcels by handler, busiest first", () => {
    const rows = [
      row({ order_id: "1", handler_name: "خالد", handler_phone: "+218925350030" }),
      row({ order_id: "2", handler_name: "خالد", handler_phone: "+218925350030", remark_class: null, reason_codes: [] , bucket: "waiting_carrier" }),
      row({ order_id: "3", handler_name: "أيمن", handler_phone: "+218922731852", bucket: "returning", reason_codes: ["returning"] }),
    ];
    const c = courierBoard(rows);
    expect(c.map((x) => x.name)).toEqual(["خالد", "أيمن"]);
    expect(c[0].held).toBe(2);
    expect(c[0].noAnswer).toBe(1);
    expect(c[1].returning).toBe(1);
  });

  test("terminal parcels are not held by anyone", () => {
    const rows = [row({ bucket: "done", status: "delivered", reason_codes: [], terminal_at: ago(2), handler_name: "خالد" })];
    expect(courierBoard(rows)).toEqual([]);
  });

  test("a market whose carrier sends no handler produces no rows", () => {
    expect(courierBoard([row({ handler_name: null, handler_phone: null })])).toEqual([]);
  });
});
