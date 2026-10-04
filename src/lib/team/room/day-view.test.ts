import { describe, test, expect } from "vitest";
import { buildDayView, dayWork, INTAKE_SILENCE_MIN } from "./day-view";
import type { DayAgent, TeamDay, RoomSettings } from "./types";

// 2026-10-02 is a Friday, 2026-10-03 a Saturday. Africa/Tripoli is UTC+2.
const SETTINGS: RoomSettings = {
  call_delay_hours: 2,
  idle_minutes: 30,
  late_minutes: 15,
  shift: { start: "14:00", end: "21:00", days: [6, 0, 1, 2, 3, 4] },
  overrides: null,
};

function agent(o: Partial<DayAgent> & { agent_id: string }): DayAgent {
  return {
    name: o.agent_id,
    avatar_url: null,
    color: null,
    phone: null,
    last_seen_at: null,
    is_available: false,
    last_action_at: "2026-10-03T10:00:00Z",
    active_7d: true,
    events: [],
    up: 0,
    rej: 0,
    att: 0,
    assigned: [],
    queue: [],
    ...o,
  };
}

/** A live Saturday at 17:20 local (15:20 UTC). */
function live(agents: DayAgent[], o: Partial<TeamDay> = {}): TeamDay {
  return {
    market_id: "ly",
    day: "2026-10-03",
    today: "2026-10-03",
    tz: "Africa/Tripoli",
    live: true,
    now_min: 1040,
    computed_at: "2026-10-03T15:20:00Z",
    last_order_at: "2026-10-03T15:00:00Z",
    settings: SETTINGS,
    team: { received: 40, received_last_at: "2026-10-03T15:00:00Z", delivered: 6 },
    agents,
    ...o,
  };
}

function past(agents: DayAgent[], o: Partial<TeamDay> = {}): TeamDay {
  return live(agents, { day: "2026-10-01", live: false, now_min: null, ...o });
}

describe("the queue: done vs left, and « non appelées > N h »", () => {
  test("splits what she holds into in progress, to call, past the delay, and confirmed", () => {
    const v = buildDayView(
      live([
        agent({
          agent_id: "tasnim",
          events: [[1030, "a"]],
          queue: [
            ["p", 300, 0], // never called, 5 h → past 2 h
            ["p", 90, 0], // never called, 1 h 30 → to call, not late yet
            ["a", 500, 1], // attempted → in progress
            ["cb", 30, 1], // callback → in progress
            ["a", 200, 0], // attempted by her predecessor, not by her → hers to call, late
            ["cf", 400, 1], // confirmed, waiting for its upload
          ],
        }),
      ]),
    );
    const r = v.rows[0];
    expect(r.queue).toEqual({ prog: 2, toCall: 3, unc: 2, uncOldestMin: 300, cf: 1 });
    expect(r.uncN).toBe(2);
    expect(v.team.unc).toBe(2);
    expect(v.team.oldest).toEqual({ name: "tasnim", min: 300 });
  });

  test("the delay is the setting, not a constant", () => {
    const v = buildDayView(
      live([agent({ agent_id: "a", queue: [["p", 200, 0]] })], { settings: { ...SETTINGS, call_delay_hours: 4 } }),
    );
    expect(v.rows[0].queue.unc).toBe(0);
    expect(v.callMin).toBe(240);
  });
});

describe("who is working, live", () => {
  test("an action within the idle window = working", () => {
    const v = buildDayView(live([agent({ agent_id: "a", events: [[900, "a"], [1030, "a"]] })]));
    expect(v.rows[0].state).toBe("working");
    expect(v.rows[0].sinceLastMin).toBe(10);
  });

  test("online by heartbeat but silent for the idle window = idle", () => {
    const v = buildDayView(
      live([agent({ agent_id: "a", events: [[900, "a"], [990, "r"]], last_seen_at: "2026-10-03T15:18:00Z" })]),
    );
    expect(v.rows[0].state).toBe("idle");
    expect(v.rows[0].sinceLastMin).toBe(50);
  });

  test("offline and silent before the end of her shift = early stop; after it = left", () => {
    const early = buildDayView(live([agent({ agent_id: "a", events: [[900, "a"], [990, "a"]] })]));
    expect(early.rows[0].state).toBe("early");
    const late = buildDayView(live([agent({ agent_id: "a", events: [[900, "a"], [1250, "a"]] })], { now_min: 1300, computed_at: "2026-10-03T19:40:00Z" }));
    expect(late.rows[0].state).toBe("left");
  });

  test("no action yet: late once her start + tolerance has passed, before that « commence à »", () => {
    expect(buildDayView(live([agent({ agent_id: "a" })])).rows[0].state).toBe("late");
    const morning = buildDayView(live([agent({ agent_id: "a" })], { now_min: 845, computed_at: "2026-10-03T12:05:00Z" }));
    expect(morning.rows[0].state).toBe("before");
  });

  test("a per-agent override moves her shift", () => {
    const v = buildDayView(
      live([agent({ agent_id: "roqaya" })], {
        now_min: 800,
        computed_at: "2026-10-03T11:20:00Z",
        settings: { ...SETTINGS, overrides: { roqaya: { start: "13:00", end: "16:00" } } },
      }),
    );
    expect(v.rows[0].state).toBe("late");
    expect(v.rows[0].shift).toEqual([780, 960]);
  });

  test("a day off the planning = rest, and a heartbeat that day is kept", () => {
    const v = buildDayView(
      live([agent({ agent_id: "a", last_seen_at: "2026-10-02T19:07:00Z" })], {
        day: "2026-10-02",
        today: "2026-10-02",
        now_min: 1436,
        computed_at: "2026-10-02T21:56:00Z",
      }),
    );
    expect(v.work).toBe(false);
    expect(v.rows[0].state).toBe("rest");
    expect(v.rows[0].seenTodayMin).toBe(1267);
  });

  test("without a planning there is no late, early or rest — only what happened", () => {
    const noShift = { ...SETTINGS, shift: null };
    expect(buildDayView(live([agent({ agent_id: "a" })], { settings: noShift })).rows[0].state).toBe("absent");
    expect(buildDayView(live([agent({ agent_id: "a", events: [[900, "a"]] })], { settings: noShift })).rows[0].state).toBe("left");
    expect(buildDayView(live([agent({ agent_id: "a" })], { settings: noShift })).work).toBeNull();
  });
});

describe("a past day", () => {
  test("states are done / absent / rest and the bar shows only finished work", () => {
    const v = buildDayView(
      past([
        agent({ agent_id: "a", events: [[860, "a"], [1200, "r"]], up: 3, rej: 1 }),
        agent({ agent_id: "b", last_action_at: "2026-10-01T09:00:00Z", events: [] }),
      ]),
    );
    expect(v.live).toBe(false);
    const a = v.rows.find((r) => r.agentId === "a")!;
    expect(a.state).toBe("done");
    expect([a.first, a.last]).toEqual([860, 1200]);
    expect(v.rows.find((r) => r.agentId === "b")!.state).toBe("absent");
  });

  test("« appelées > N h » = orders assigned that day called late or never; cancelled ones need no call", () => {
    const v = buildDayView(
      past([
        agent({
          agent_id: "a",
          assigned: [
            [800, 30, 0],
            [800, 150, 0],
            [805, null, 0],
            [900, null, 1],
          ],
        }),
      ]),
    );
    const a = v.rows[0];
    expect(a.assigned).toBe(4);
    expect(a.uncN).toBe(2);
    expect(v.team.rxTotal).toBe(3);
    expect(v.team.unc).toBe(2);
  });
});

describe("the row's facts", () => {
  test("assignments within 10 minutes become one marker; sessions break after 20 silent minutes", () => {
    const v = buildDayView(
      live([
        agent({
          agent_id: "a",
          assigned: [
            [790, 5, 0],
            [795, 5, 0],
            [900, 5, 0],
          ],
          events: [[800, "a"], [810, "a"], [840, "a"], [845, "u"], [1030, "a"]],
        }),
      ]),
    );
    const a = v.rows[0];
    expect(a.asg).toEqual([{ m: 790, n: 2 }, { m: 900, n: 1 }]);
    expect(a.sessions).toEqual([{ a: 800, b: 810 }, { a: 840, b: 845 }, { a: 1030, b: 1030 }]);
    expect(a.ups).toEqual([845]);
    expect(a.activeMin).toBe(40); // buckets 80, 81, 84, 103
    expect(a.lateBy).toBe(-40);
    expect(a.plannedMin).toBe(1040 - 840);
  });
});

describe("the strip", () => {
  test("active agents, totals, and who is off-rhythm", () => {
    const v = buildDayView(
      live([
        agent({ agent_id: "a", events: [[1030, "a"]], up: 5, rej: 2 }),
        agent({ agent_id: "b", events: [[900, "a"]], last_seen_at: "2026-10-03T15:19:00Z", up: 1, rej: 3 }),
        agent({ agent_id: "c" }),
      ]),
    );
    expect(v.team.working.map((r) => r.agentId)).toEqual(["a"]);
    expect(v.team.bad).toEqual({ idle: 1, late: 1, early: 0 });
    expect(v.team.up).toBe(6);
    expect(v.team.rej).toBe(5);
    expect(v.team.received).toBe(40);
    expect(v.team.lastInMin).toBe(1020);
    expect(v.team.delivered).toBe(6);
  });

  test("rows run working → idle → late → early → left → before → rest, then by work done", () => {
    const v = buildDayView(
      live([
        agent({ agent_id: "z-late" }),
        agent({ agent_id: "y-work-small", events: [[1030, "a"]], up: 1 }),
        agent({ agent_id: "x-work-big", events: [[1035, "a"]], up: 9 }),
      ]),
    );
    expect(v.rows.map((r) => r.agentId)).toEqual(["x-work-big", "y-work-small", "z-late"]);
  });

  test("accounts silent for 7 days leave the table for the dormant line, with their confirmed orders", () => {
    const v = buildDayView(
      live([
        agent({ agent_id: "a", events: [[1030, "a"]] }),
        agent({ agent_id: "hend", active_7d: false, last_action_at: "2026-09-16T12:00:00Z", queue: [["cf", 9000, 1]] }),
      ]),
    );
    expect(v.rows.map((r) => r.agentId)).toEqual(["a"]);
    expect(v.dormant).toEqual([{ agentId: "hend", name: "hend", avatarUrl: null, color: null, cf: 1, lastActionAt: "2026-09-16T12:00:00Z" }]);
  });

  test("a past day keeps an agent who worked that day even if she has been silent since", () => {
    const v = buildDayView(past([agent({ agent_id: "old", active_7d: false, events: [[900, "a"]] })]));
    expect(v.rows.map((r) => r.agentId)).toEqual(["old"]);
    expect(v.dormant).toEqual([]);
  });
});

describe("intake", () => {
  test("silence counts from the last order received, past six hours", () => {
    expect(buildDayView(live([])).intakeSilentMin).toBeNull();
    const v = buildDayView(live([], { last_order_at: "2026-09-29T15:30:00Z" }));
    expect(v.intakeSilentMin).toBe(4 * 1440 - 10);
    expect(INTAKE_SILENCE_MIN).toBe(360);
  });

  test("a market that never received an order is not « silent »", () => {
    expect(buildDayView(live([], { last_order_at: null })).intakeSilentMin).toBeNull();
  });
});

describe("the timeline window", () => {
  test("starts an hour before the first mark, between 08:00 and 12:00", () => {
    expect(buildDayView(live([agent({ agent_id: "a", events: [[800, "a"]] })])).t0).toBe(720);
    expect(buildDayView(live([agent({ agent_id: "a", events: [[100, "a"]] })])).t0).toBe(480);
    expect(buildDayView(live([agent({ agent_id: "a", events: [[650, "a"]] })], { settings: { ...SETTINGS, shift: null } })).t0).toBe(540);
  });
});

describe("v6 — « En poste »: stretches of her day", () => {
  test("her actions (calls, decisions, uploads) chain into stretches; a gap over 60 min starts a new one", () => {
    const v = buildDayView(
      live([
        agent({
          agent_id: "a",
          events: [[840, "a"], [870, "u"], [930, "r"], [991, "a"], [1000, "a"]],
        }),
      ]),
    );
    const r = v.rows[0];
    // 840 → 930 (gaps of 30 and 60 stay together), then 991 → 1000 after a 61-minute pause.
    expect(r.stretches).toEqual([
      { b: 840, e: 930, n: 3 },
      { b: 991, e: 1000, n: 2 },
    ]);
    expect(r.onShiftMin).toBe(90 + 9);
  });

  test("nothing done is nothing on shift", () => {
    const r = buildDayView(live([agent({ agent_id: "a" })])).rows[0];
    expect(r.stretches).toEqual([]);
    expect(r.onShiftMin).toBe(0);
  });

  test("a live day stops at now", () => {
    const r = buildDayView(live([agent({ agent_id: "a", events: [[1000, "a"], [1100, "a"]] })])).rows[0];
    expect(r.stretches).toEqual([{ b: 1000, e: 1000, n: 1 }]);
  });
});

describe("v6 — the work of the day (waffle and rings)", () => {
  test("done = uploaded + rejected; in hand, live only = in progress, to call, past the delay", () => {
    const v = buildDayView(
      live([
        agent({ agent_id: "a", up: 3, rej: 2, queue: [["a", 30, 1], ["p", 30, 0], ["p", 200, 0], ["cf", 500, 1]] }),
        agent({ agent_id: "b", up: 1, rej: 0, queue: [["cb", 10, 1]] }),
      ]),
    );
    const a = v.rows.find((r) => r.agentId === "a")!;
    expect(dayWork([a], true)).toEqual({ up: 3, rej: 2, prog: 1, todo: 1, late: 1 });
    expect(dayWork(v.rows, true)).toEqual({ up: 4, rej: 2, prog: 2, todo: 1, late: 1 });
  });

  test("a past day only knows what was done", () => {
    const v = buildDayView(past([agent({ agent_id: "a", up: 3, rej: 2, queue: [["p", 300, 0]] })]));
    expect(dayWork(v.rows, false)).toEqual({ up: 3, rej: 2, prog: 0, todo: 0, late: 0 });
  });
});

describe("v6 — her colour", () => {
  test("rows and dormant accounts carry the colour the database gave her", () => {
    const v = buildDayView(
      live([
        agent({ agent_id: "a", color: "pink" }),
        agent({ agent_id: "z", color: "lime", active_7d: false, last_action_at: "2026-09-01T10:00:00Z" }),
      ]),
    );
    expect(v.rows[0].color).toBe("pink");
    expect(v.dormant[0].color).toBe("lime");
  });
});
