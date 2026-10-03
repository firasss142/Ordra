/**
 * Salle de contrôle — the day: the strip, the agents card and the panel's timeline,
 * from one `get_team_day` payload. The rules are the prototype's (`build()` and
 * `queueOf()` in prototypes/team-v5.html); thresholds come from the settings the
 * payload carries, so the page and the bell apply the same ones.
 */
import { ONLINE_THRESHOLD_MS } from "@/lib/presence";
import { isWorkday, resolveSettings, shiftFor, type ResolvedSettings } from "./settings";
import { localDayMinute, minutesBetween } from "./time";
import type { DayAgent, DayEvent, TeamDay } from "./types";

/** No order for this long and the page says the door is shut (prototype: 6 h). */
export const INTAKE_SILENCE_MIN = 360;
/** Two actions further apart than this start a new session on the timeline. */
const SESSION_GAP_MIN = 20;
/** Assignments this close together are one marker. */
const ASSIGN_GROUP_MIN = 10;

export type AgentState =
  | "working"
  | "idle"
  | "late"
  | "early"
  | "left"
  | "before"
  | "rest"
  | "absent"
  | "done";

export interface QueueSplit {
  /** Called by her since assignment, still open. */
  prog: number;
  /** Not called by her since assignment. */
  toCall: number;
  /** Of toCall, held longer than the call delay. */
  unc: number;
  uncOldestMin: number;
  /** Confirmed, waiting for the upload. */
  cf: number;
}

export interface AgentDayRow {
  agentId: string;
  name: string;
  avatarUrl: string | null;
  phone: string | null;
  lastActionAt: string | null;
  online: boolean;
  state: AgentState;
  /** Minutes since her last action (live only). */
  sinceLastMin: number | null;
  first: number | null;
  last: number | null;
  shift: [number, number] | null;
  /** Minute of the day her heartbeat was last seen, when it was that day. */
  seenTodayMin: number | null;
  assigned: number;
  up: number;
  rej: number;
  att: number;
  queue: QueueSplit;
  /** Live: « non appelées > N h ». Past day: assigned that day, called late or never. */
  uncN: number;
  /** Past day: assignments that needed a call. */
  rxTotal: number;
  events: DayEvent[];
  ups: number[];
  asg: { m: number; n: number }[];
  sessions: { a: number; b: number }[];
  activeMin: number;
  plannedMin: number;
  /** Minutes between her planned start and her first action (negative = early). */
  lateBy: number | null;
}

export interface DormantAgent {
  agentId: string;
  name: string;
  avatarUrl: string | null;
  cf: number;
  lastActionAt: string | null;
}

export interface DayView {
  day: string;
  today: string;
  tz: string;
  live: boolean;
  /** The minute of the day the view is cut at: now when live, midnight otherwise. */
  cut: number;
  /** Whether the planning makes this a working day; null with no planning. */
  work: boolean | null;
  callMin: number;
  idleMin: number;
  lateMin: number;
  settings: ResolvedSettings;
  rows: AgentDayRow[];
  dormant: DormantAgent[];
  team: {
    working: AgentDayRow[];
    bad: { idle: number; late: number; early: number };
    /** Past day: the first and last action of anyone. */
    firstAll: number | null;
    lastAll: number | null;
    received: number;
    lastInMin: number | null;
    up: number;
    rej: number;
    delivered: number;
    unc: number;
    oldest: { name: string; min: number } | null;
    rxTotal: number;
  };
  /** Minutes since the last order received, once past INTAKE_SILENCE_MIN. */
  intakeSilentMin: number | null;
  /** Where the timeline starts (minute of day). */
  t0: number;
}

const STATE_ORDER: Record<AgentState, number> = {
  working: 0,
  done: 0,
  idle: 1,
  late: 2,
  early: 3,
  left: 4,
  before: 5,
  rest: 6,
  absent: 6,
};

function splitQueue(agent: DayAgent, live: boolean, callMin: number): QueueSplit {
  const out: QueueSplit = { prog: 0, toCall: 0, unc: 0, uncOldestMin: 0, cf: 0 };
  for (const [code, held, called] of agent.queue) {
    if (code === "cf") {
      out.cf += 1;
      continue;
    }
    if (!live) continue;
    if (called) out.prog += 1;
    else {
      out.toCall += 1;
      if (held > callMin) {
        out.unc += 1;
        out.uncOldestMin = Math.max(out.uncOldestMin, held);
      }
    }
  }
  return out;
}

function sessionsOf(mins: number[]): { a: number; b: number }[] {
  const out: { a: number; b: number }[] = [];
  for (const m of mins) {
    const cur = out[out.length - 1];
    if (cur && m - cur.b <= SESSION_GAP_MIN) cur.b = m;
    else out.push({ a: m, b: m });
  }
  return out;
}

function groupAssignments(mins: number[]): { m: number; n: number }[] {
  const out: { m: number; n: number; last: number }[] = [];
  for (const m of mins) {
    const prev = out[out.length - 1];
    if (prev && m - prev.last <= ASSIGN_GROUP_MIN) {
      prev.n += 1;
      prev.last = m;
    } else out.push({ m, n: 1, last: m });
  }
  return out.map(({ m, n }) => ({ m, n }));
}

export function buildDayView(d: TeamDay): DayView {
  const rs = resolveSettings(d.settings);
  const live = d.live;
  const cut = live ? d.now_min ?? 1440 : 1440;
  const work = isWorkday(rs, d.day);
  const nowIso = d.computed_at;

  const included = d.agents.filter((a) => a.active_7d || a.events.length > 0 || a.assigned.length > 0);
  const dormantAgents = d.agents.filter((a) => !included.includes(a));

  const rows: AgentDayRow[] = included.map((a) => {
    const mins = a.events.map((e) => e[0]).filter((m) => m <= cut);
    const first = mins.length ? mins[0] : null;
    const last = mins.length ? mins[mins.length - 1] : null;
    const shift = shiftFor(rs, a.agent_id);
    const agentWork = work ?? (rs.overrides[a.agent_id] ? true : null);
    const online = !!a.last_seen_at && Date.parse(nowIso) - Date.parse(a.last_seen_at) < ONLINE_THRESHOLD_MS;
    const seen = a.last_seen_at ? localDayMinute(a.last_seen_at, d.tz) : null;
    const seenTodayMin = seen && seen.day === d.day ? seen.min : null;
    const queue = splitQueue(a, live, rs.callMin);

    const judged = a.assigned.filter((x) => x[2] === 0);
    const calledLate = judged.filter((x) => x[1] === null || x[1] > rs.callMin).length;

    let state: AgentState;
    const sinceLastMin = live && last !== null ? cut - last : null;
    if (live) {
      if (sinceLastMin !== null && sinceLastMin < rs.idleMin) state = "working";
      else if (last !== null && online) state = "idle";
      else if (last !== null) {
        state = agentWork && shift && last < shift[1] - rs.lateMin ? "early" : "left";
      } else if (agentWork === false) state = "rest";
      else if (agentWork && shift) state = cut >= shift[0] + rs.lateMin ? "late" : "before";
      else state = "absent";
    } else if (last !== null) state = "done";
    else state = agentWork === false ? "rest" : "absent";

    const planned = agentWork && shift ? Math.max(0, Math.min(cut, shift[1]) - shift[0]) : 0;
    return {
      agentId: a.agent_id,
      name: a.name,
      avatarUrl: a.avatar_url,
      phone: a.phone,
      lastActionAt: a.last_action_at,
      online,
      state,
      sinceLastMin,
      first,
      last,
      shift,
      seenTodayMin,
      assigned: a.assigned.length,
      up: a.up,
      rej: a.rej,
      att: a.att,
      queue,
      uncN: live ? queue.unc : calledLate,
      rxTotal: judged.length,
      events: a.events.filter((e) => e[0] <= cut),
      ups: a.events.filter((e) => e[1] === "u" && e[0] <= cut).map((e) => e[0]),
      asg: groupAssignments(a.assigned.map((x) => x[0]).filter((m) => m <= cut)),
      sessions: sessionsOf(mins),
      activeMin: new Set(mins.map((m) => Math.floor(m / 10))).size * 10,
      plannedMin: planned,
      lateBy: agentWork && shift && first !== null ? first - shift[0] : null,
    };
  });

  rows.sort(
    (x, y) =>
      STATE_ORDER[x.state] - STATE_ORDER[y.state] ||
      y.up + y.rej - (x.up + x.rej) ||
      x.name.localeCompare(y.name),
  );

  const working = rows.filter((r) => r.state === "working");
  const count = (s: AgentState) => rows.filter((r) => r.state === s).length;
  const acted = rows.filter((r) => r.first !== null);
  const oldestRow = rows
    .filter((r) => r.queue.unc > 0)
    .sort((x, y) => y.queue.uncOldestMin - x.queue.uncOldestMin)[0];

  const marks: number[] = [];
  for (const r of rows) {
    marks.push(...r.events.map((e) => e[0]), ...r.asg.map((x) => x.m));
    if (r.shift && (work ?? true)) marks.push(r.shift[0]);
    if (r.seenTodayMin !== null) marks.push(r.seenTodayMin);
  }
  const t0 = marks.length ? Math.max(480, Math.min(720, Math.floor(Math.min(...marks) / 60) * 60 - 60)) : 720;

  const silence = d.last_order_at ? minutesBetween(d.last_order_at, nowIso) : null;

  return {
    day: d.day,
    today: d.today,
    tz: d.tz,
    live,
    cut,
    work,
    callMin: rs.callMin,
    idleMin: rs.idleMin,
    lateMin: rs.lateMin,
    settings: rs,
    rows,
    dormant: dormantAgents.map((a) => ({
      agentId: a.agent_id,
      name: a.name,
      avatarUrl: a.avatar_url,
      cf: a.queue.filter((q) => q[0] === "cf").length,
      lastActionAt: a.last_action_at,
    })),
    team: {
      working,
      bad: { idle: count("idle"), late: count("late"), early: count("early") },
      firstAll: acted.length ? Math.min(...acted.map((r) => r.first!)) : null,
      lastAll: acted.length ? Math.max(...acted.map((r) => r.last!)) : null,
      received: d.team.received,
      lastInMin: d.team.received_last_at ? localDayMinute(d.team.received_last_at, d.tz).min : null,
      up: rows.reduce((s, r) => s + r.up, 0),
      rej: rows.reduce((s, r) => s + r.rej, 0),
      delivered: d.team.delivered,
      unc: rows.reduce((s, r) => s + r.uncN, 0),
      oldest: oldestRow ? { name: oldestRow.name, min: oldestRow.queue.uncOldestMin } : null,
      rxTotal: rows.reduce((s, r) => s + r.rxTotal, 0),
    },
    intakeSilentMin: silence !== null && silence > INTAKE_SILENCE_MIN ? silence : null,
    t0,
  };
}
