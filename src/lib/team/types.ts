/**
 * Wire types for the team control room — the exact JSON shapes returned by the
 * `get_team_live` and `get_team_performance` RPCs (supabase/migrations/
 * 20260907000002_team_rpcs.sql). Keep these in step with the SQL; nothing
 * else in the app is allowed to guess at these payloads.
 */

export type PresenceState = "online" | "idle" | "offline";

export interface AgentTargets {
  daily_treated: number | null;
  min_rate: number | null;
  conf_per_hour?: number | null;
  throughput?: number | null;
}

export interface LiveLastAction {
  status_to: string;
  at: string;
  external_id: string | null;
  customer_name: string | null;
}

export interface LiveQueueProduct {
  product_name: string | null;
  status: string;
  n: number;
  oldest_days: number | null;
}

export interface LiveAgent {
  agent_id: string;
  name: string;
  avatar_url: string | null;
  last_seen_at: string | null;
  presence: PresenceState;
  last_action: LiveLastAction | null;
  today: { touches: number; treated: number; confirmed: number; active_minutes: number };
  queue: {
    total: number;
    older_24h: number;
    exhausted: number;
    confirmed_awaiting: number;
    overdue_callbacks: number;
    stale_untouched: number;
    oldest_days: number | null;
    by_product: LiveQueueProduct[];
  };
  targets: AgentTargets;
}

export type BlockedKind = "exhausted" | "confirmed_stuck" | "overdue_callback";

export interface BlockedOrder {
  order_id: string;
  external_id: string | null;
  customer_name: string | null;
  product_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  kind: BlockedKind;
  age_days: number;
  callback_at: string | null;
}

export interface UpcomingCallback {
  order_id: string;
  external_id: string | null;
  customer_name: string | null;
  product_name: string | null;
  agent_id: string | null;
  agent_name: string | null;
  callback_at: string;
}

export interface NamedCount {
  agent_id: string;
  name: string;
  count: number;
}

export interface TeamLive {
  computed_at: string;
  tz: string;
  market_id: string;
  defaults: { daily_treated: number; min_rate: number };
  presence: { online: number; total: number };
  tiles: {
    exhausted: { count: number; oldest_days: number | null; by_agent: NamedCount[] };
    orphan_queues: {
      count: number;
      agents_count: number;
      confirmed_never_uploaded: number;
      by_agent: NamedCount[];
    };
    overdue_callbacks: { count: number; oldest_hours: number | null };
    never_called: { count: number; oldest_hours: number | null };
  };
  blocked_count: number;
  agents: LiveAgent[];
  blocked: BlockedOrder[];
  callbacks_upcoming: UpcomingCallback[];
}

export interface PerfDaily {
  day: string;
  active_minutes: number;
  treated: number;
  confirmed: number;
}

export interface PerfProductSlice {
  key: string;
  name: string;
  image_url: string | null;
  treated: number;
  confirmed: number;
}

export interface PerfAgent {
  agent_id: string;
  name: string;
  avatar_url: string | null;
  last_seen_at: string | null;
  treated: number;
  confirmed: number;
  rejected: number;
  touches: number;
  active_minutes: number;
  days_active: number;
  /** Local days, oldest first, covering the period AND the 14 days before p_to. */
  daily: PerfDaily[];
  products: PerfProductSlice[];
  motifs: { reason: string; n: number }[];
  targets: AgentTargets;
}

export interface PerfProduct {
  key: string;
  name: string;
  image_url: string | null;
  treated: number;
  confirmed: number;
  agents: { agent_id: string; treated: number; confirmed: number }[];
}

export interface TeamPerformance {
  from: string;
  to: string;
  tz: string;
  market_id: string;
  defaults: { daily_treated: number; min_rate: number; conf_per_hour: number; team_weekly_conf: number };
  team: {
    treated: number;
    confirmed: number;
    active_minutes: number;
    agents_active: number;
    agents_total: number;
  };
  agents: PerfAgent[];
  products: PerfProduct[];
}

export type TargetMetric = "daily_treated" | "min_rate" | "conf_per_hour" | "throughput";

/* ────────────────────────────────────────────────────────────────
 * get_agent_day_detail — one agent, one market-local day.
 * (supabase/migrations/20260908000001_agent_day_detail_rpc.sql)
 * ──────────────────────────────────────────────────────────────── */

export interface DayTotals {
  /**
   * The day's workload pool: orders in this agent's hands and workable that day,
   * reconstructed from orders.assigned_to plus the assignment-event log.
   */
  assigned: number;
  /**
   * Real calls logged that day — a note-stamped dial, or a row landing on
   * confirmed/rejected/callback_scheduled. Never a field edit.
   */
  calls: number;
  /** Distinct orders that got at least one real call. */
  attempted: number;
  /** Distinct orders the agent acted on in any way, calls included. */
  touched: number;
  /** Distinct orders reaching confirmed OR rejected. */
  treated: number;
  confirmed: number;
  rejected: number;
  active_minutes: number;
  /** Of that day's confirmations, how many have since reached the carrier. */
  uploaded: number;
  /** Confirmed that day and STILL sitting at confirmed — never shipped. */
  stuck_confirmed: number;
  /** Confirmed that day, then cancelled/deleted/rejected afterwards. */
  lost_after_confirm: number;
}

export interface DayHour {
  hour: number;
  active_minutes: number;
  treated: number;
  confirmed: number;
}

export interface DayProduct {
  key: string;
  name: string;
  image_url: string | null;
  calls: number;
  attempted: number;
  touched: number;
  treated: number;
  confirmed: number;
  uploaded: number;
}

export interface DayAttempt {
  /** The true attempts_count stamped on the note — can exceed 3. */
  n: number | null;
  gap_min: number;
  late: boolean;
}

export interface DayCadenceOrder {
  order_id: string;
  external_id: string | null;
  product_name: string;
  status_now: string;
  worst_gap_min: number;
  attempts: DayAttempt[];
}

export interface DayCadence {
  /** Follow-ups on this day that had a previous attempt to measure against. */
  judged: number;
  late: number;
  median_gap_min: number | null;
  tiers: { ok: number; late: number; abandoned: number };
  orders: DayCadenceOrder[];
}

export interface DayQueue {
  open: number;
  uploaded: number;
  rejected: number;
  by_attempts_left: { attempts_left: number; n: number }[];
}

export interface DaySeriesPoint {
  day: string;
  active_minutes: number;
  treated: number;
  confirmed: number;
  uploaded: number;
}

export interface AgentDayDetail {
  day: string;
  tz: string;
  market_id: string;
  agent: { agent_id: string; name: string; avatar_url: string | null } | null;
  targets: { daily_treated: number; min_rate: number; conf_per_hour: number; max_attempts: number };
  totals: DayTotals;
  hourly: DayHour[];
  /** hour → number of late follow-ups handled in it. */
  late_hours: Record<string, number>;
  products: DayProduct[];
  motifs: { reason: string; n: number }[];
  cadence: DayCadence;
  queue_end_of_day: DayQueue;
  series: DaySeriesPoint[];
}
