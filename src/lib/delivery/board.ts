/**
 * The manager board's arithmetic: one verdict per agent against the market's
 * target, the three frames of an agent's page, the parcels that block, and who
 * holds the parcels right now.
 *
 * The owner rejected a metric table (medians, percentages in the target) as
 * "not actionable or understandable"; what is here instead is a judgement —
 * En retard / Inactif aujourd'hui / À jour — with the reason in a sentence,
 * and the three worst parcels to open. Nothing ranks agents against each other
 * and nothing compares them to a team average: the only comparison is each
 * agent against the target. See plans/suivi-livraison.md decision 40.
 *
 * Pure, so the numbers a manager acts on can be argued with in a test.
 * Mirrors teamStats() / agentPage() in prototypes/suivi-livraison-manager-v1.html.
 */
import type { Bucket, WorklistRow } from "./types";
import { partitionStalled } from "./worklist";

/**
 * How long a parcel may wait for its first action before the manager should
 * hear about it. The real value is the market setting
 * `delivery_first_action_hours`, counted on shift hours; this is its default.
 */
export const DEFAULT_TARGET_HOURS = 4;

export type Verdict = "late" | "idle" | "ok";

export interface AgentRef {
  id: string;
  name: string;
}

/**
 * What the ledger answers for an agent: nothing here can be derived from the
 * worklist, because the worklist carries only the last action per parcel.
 */
export interface AgentActivity {
  agent_id: string;
  actions_today: number;
  reached_today: number;
  whatsapp_today: number;
  saved_week: number;
  lost_week: number;
  /** Actions per day over the last 7 days, today last. */
  week: number[];
}

const NO_ACTIVITY: Omit<AgentActivity, "agent_id"> = {
  actions_today: 0, reached_today: 0, whatsapp_today: 0, saved_week: 0, lost_week: 0,
  week: [0, 0, 0, 0, 0, 0, 0],
};

/**
 * When the parcel's current reason appeared. The carrier event is the honest
 * clock — a remark written this morning is a new reason even on a parcel the
 * agent called about yesterday — and creation is the fallback for a parcel the
 * carrier has never touched.
 */
const reasonAt = (row: WorklistRow): number =>
  Date.parse(row.latest_event_at ?? row.created_at ?? "") || 0;

/**
 * The parcels an agent is actually expected to work: act-now, minus the stalls
 * the carrier abandoned months ago. Those are set aside on the agent's own
 * screen too, and holding a manager's verdict hostage to them would mark every
 * agent late for a backlog none of them created.
 */
export function liveWork(rows: WorklistRow[], now: number): WorklistRow[] {
  return partitionStalled(rows.filter((r) => r.bucket === "act_now"), now).live;
}

/**
 * A parcel is late when it has waited longer than the target and no action has
 * been taken since its reason appeared. An agent who called yesterday about a
 * remark written today is still late; one who called after the remark is not.
 */
export function lateParcels(rows: WorklistRow[], targetHours: number, now: number): WorklistRow[] {
  return liveWork(rows, now)
    .filter((r) => (r.hours_on_status ?? 0) > targetHours)
    .filter((r) => !r.last_action_at || Date.parse(r.last_action_at) < reasonAt(r))
    .sort((a, b) => (b.hours_on_status ?? 0) - (a.hours_on_status ?? 0));
}

export interface VerdictResult {
  verdict: Verdict;
  late: WorklistRow[];
  live: WorklistRow[];
}

/**
 * One judgement per agent. Late beats idle: a parcel past the target is a fact
 * about the work, while "no action today" is only a fact about the day.
 */
export function verdictOf(
  rows: WorklistRow[],
  activity: AgentActivity | null,
  targetHours: number,
  now: number,
): VerdictResult {
  const live = liveWork(rows, now);
  const late = lateParcels(rows, targetHours, now);
  const actions = activity?.actions_today ?? 0;
  const verdict: Verdict = late.length > 0 ? "late" : live.length > 0 && actions === 0 ? "idle" : "ok";
  return { verdict, late, live };
}

/** One segment of the load bar: how much of an agent's live list sits in a bucket. */
export interface LoadSegment {
  bucket: Exclude<Bucket, "done">;
  count: number;
  /** Percentage of the agent's live parcels, so the bar always fills. */
  share: number;
}

const LOAD_ORDER: Exclude<Bucket, "done">[] = ["returning", "act_now", "waiting_customer", "waiting_carrier"];

export function agentLoad(rows: WorklistRow[], now: number): LoadSegment[] {
  const live = rows.filter((r) => r.bucket !== "done" && !isDeadStall(r, now));
  if (live.length === 0) return [];
  return LOAD_ORDER
    .map((bucket) => {
      const count = live.filter((r) => r.bucket === bucket).length;
      return { bucket, count, share: (count / live.length) * 100 };
    })
    .filter((s) => s.count > 0);
}

/** Whether this row is one of the parcels the carrier abandoned months ago. */
function isDeadStall(row: WorklistRow, now: number): boolean {
  if (row.bucket !== "act_now") return false;
  return partitionStalled([row], now).stalled.length === 1;
}

/**
 * The three parcels to open first: everything late, longest wait first, then
 * whatever else is waiting. Three is what fits without turning the panel into
 * a second list — the list itself is one click away.
 */
export function worstParcels(rows: WorklistRow[], targetHours: number, now: number): WorklistRow[] {
  const late = lateParcels(rows, targetHours, now);
  const rest = liveWork(rows, now)
    .filter((r) => !late.includes(r))
    .sort((a, b) => (b.hours_on_status ?? 0) - (a.hours_on_status ?? 0));
  return [...late, ...rest].slice(0, 3);
}

export interface AgentBoard extends AgentRef {
  verdict: Verdict;
  /** Parcels needing an action now, the long-dead stalls excluded. */
  toTreat: number;
  lateCount: number;
  /** The longest any of them has waited, in hours; 0 when none wait. */
  oldestHours: number;
  returning: number;
  waiting: number;
  /** Everything not terminal, which is what a reassignment would move. */
  inFlight: number;
  done: number;
  actionsToday: number;
  reachedToday: number;
  whatsappToday: number;
  savedWeek: number;
  lostWeek: number;
  week: number[];
  load: LoadSegment[];
  worst: WorklistRow[];
  /** Value of the parcels waiting for an action, in the market currency. */
  amount: number;
}

export function agentBoard(
  allRows: WorklistRow[],
  agent: AgentRef,
  activity: AgentActivity | null,
  targetHours: number,
  now: number,
): AgentBoard {
  const rows = allRows.filter((r) => r.assigned_to === agent.id);
  const { verdict, late, live } = verdictOf(rows, activity, targetHours, now);
  const a = { ...NO_ACTIVITY, ...(activity ?? {}) };
  return {
    ...agent,
    verdict,
    toTreat: live.length,
    lateCount: late.length,
    oldestHours: live.reduce((m, r) => Math.max(m, r.hours_on_status ?? 0), 0),
    returning: rows.filter((r) => r.bucket === "returning").length,
    waiting: rows.filter((r) => r.bucket === "waiting_customer" || r.bucket === "waiting_carrier").length,
    inFlight: rows.filter((r) => r.bucket !== "done").length,
    done: rows.filter((r) => r.bucket === "done").length,
    actionsToday: a.actions_today,
    reachedToday: a.reached_today,
    whatsappToday: a.whatsapp_today,
    savedWeek: a.saved_week,
    lostWeek: a.lost_week,
    week: a.week.length === 7 ? a.week : NO_ACTIVITY.week,
    load: agentLoad(rows, now),
    worst: worstParcels(rows, targetHours, now),
    amount: live.reduce((s, r) => s + (r.total_price ?? 0), 0),
  };
}

export interface MarketSummary {
  late: AgentBoard[];
  idle: AgentBoard[];
  ok: AgentBoard[];
  /** Parcels in the market needing an action now. */
  toTreat: number;
  /** Of those, how many have waited past the target with no action since. */
  lateParcels: number;
  savedWeek: number;
  lostWeek: number;
}

/**
 * The all-agents view: every agent placed in one of three groups, alphabetical
 * inside the group. Deliberately not sorted by how badly they are doing —
 * grouping says who needs help, a ranking would say who is worst, and the
 * owner asked for the first.
 */
export function marketSummary(
  rows: WorklistRow[],
  agents: AgentRef[],
  activities: AgentActivity[],
  targetHours: number,
  now: number,
): MarketSummary {
  const byId = new Map(activities.map((a) => [a.agent_id, a]));
  const boards = agents
    .map((agent) => agentBoard(rows, agent, byId.get(agent.id) ?? null, targetHours, now))
    .sort((a, b) => a.name.localeCompare(b.name));
  const group = (v: Verdict) => boards.filter((b) => b.verdict === v);
  return {
    late: group("late"),
    idle: group("idle"),
    ok: group("ok"),
    toTreat: boards.reduce((n, b) => n + b.toTreat, 0),
    lateParcels: boards.reduce((n, b) => n + b.lateCount, 0),
    savedWeek: boards.reduce((n, b) => n + b.savedWeek, 0),
    lostWeek: boards.reduce((n, b) => n + b.lostWeek, 0),
  };
}

export interface CourierRow {
  name: string;
  phone: string | null;
  /** Parcels this courier is holding right now. */
  held: number;
  /** Of those, how many carry a "customer does not answer" remark. */
  noAnswer: number;
  returning: number;
  toTreat: number;
}

/**
 * Who is holding the market's parcels, from the Darb mirror. A courier with
 * five no-answers is a conversation to have with the branch, not with five
 * customers — which is the whole reason this table exists.
 */
export function courierBoard(rows: WorklistRow[]): CourierRow[] {
  const byName = new Map<string, CourierRow>();
  for (const row of rows) {
    if (!row.handler_name || row.bucket === "done") continue;
    const c = byName.get(row.handler_name) ?? {
      name: row.handler_name, phone: row.handler_phone, held: 0, noAnswer: 0, returning: 0, toTreat: 0,
    };
    c.held += 1;
    if (row.remark_class === "no_answer") c.noAnswer += 1;
    if (row.bucket === "returning") c.returning += 1;
    if (row.bucket === "act_now") c.toTreat += 1;
    byName.set(row.handler_name, c);
  }
  return [...byName.values()].sort((a, b) => b.held - a.held);
}

export interface CarrierRow {
  id: string;
  name: string;
  /** Parcels in flight with this carrier right now. */
  inFlight: number;
  toTreat: number;
  returning: number;
}

/** What each carrier is carrying now. The 30-day delivered/returned split is a
 * separate question the P&L already answers; this is the live load. */
export function carrierBoard(rows: WorklistRow[]): CarrierRow[] {
  const byId = new Map<string, CarrierRow>();
  for (const row of rows) {
    if (row.bucket === "done" || !row.carrier_id) continue;
    const c = byId.get(row.carrier_id) ?? {
      id: row.carrier_id, name: row.carrier_name ?? "—", inFlight: 0, toTreat: 0, returning: 0,
    };
    c.inFlight += 1;
    if (row.bucket === "act_now") c.toTreat += 1;
    if (row.bucket === "returning") c.returning += 1;
    byId.set(row.carrier_id, c);
  }
  return [...byId.values()].sort((a, b) => b.inFlight - a.inFlight);
}

/** Agents present in the worklist, for a market whose roster has not loaded. */
export function agentsFromRows(rows: WorklistRow[]): AgentRef[] {
  const byId = new Map<string, AgentRef>();
  for (const row of rows) {
    if (row.assigned_to && !byId.has(row.assigned_to)) {
      byId.set(row.assigned_to, { id: row.assigned_to, name: row.agent_name ?? "—" });
    }
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}
