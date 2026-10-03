/**
 * Salle de contrôle v5 — the payloads of the four RPCs in
 * supabase/migrations/20261003200000_team_control_room_v5.sql, as the API returns them.
 * Spec: prototypes/team-v5.html · plans/team-control-room-v5.md.
 */

/** a = attempt, b = callback, c = confirmed, r = rejected, u = uploaded. */
export type EventKind = "a" | "b" | "c" | "r" | "u";
/** [minute of the local day, kind] */
export type DayEvent = [number, EventKind];
/** [minute of the local day it was assigned, minutes to the holder's first call or null, 1 = since cancelled] */
export type DayAssignment = [number, number | null, 0 | 1];
/** p = never touched, a = attempted, cb = callback, cf = confirmed awaiting upload. */
export type QueueCode = "p" | "a" | "cb" | "cf";
/** [code, minutes held since assignment, 1 = called by the holder since assignment] */
export type QueueItem = [QueueCode, number, 0 | 1];

export interface ShiftSetting {
  start: string; // "HH:MM"
  end: string;
  days: number[]; // 0 = Sunday … 6 = Saturday
  timezone?: string;
}

export type ShiftOverrides = Record<string, { start: string; end: string }>;

export interface RoomSettings {
  call_delay_hours: number;
  idle_minutes: number;
  late_minutes: number;
  shift: ShiftSetting | null;
  overrides: ShiftOverrides | null;
}

export interface DayAgent {
  agent_id: string;
  name: string;
  avatar_url: string | null;
  phone: string | null;
  last_seen_at: string | null;
  is_available: boolean;
  last_action_at: string | null;
  active_7d: boolean;
  events: DayEvent[];
  up: number;
  rej: number;
  att: number;
  assigned: DayAssignment[];
  queue: QueueItem[];
}

export interface TeamDay {
  market_id: string;
  day: string;
  today: string;
  tz: string;
  live: boolean;
  now_min: number | null;
  computed_at: string;
  last_order_at: string | null;
  settings: RoomSettings;
  team: { received: number; received_last_at: string | null; delivered: number };
  agents: DayAgent[];
}

export interface FunnelAgent {
  agent_id: string;
  name: string;
  avatar_url: string | null;
  is_active: boolean;
  last_action_at: string | null;
  assigned: number;
  uploaded: number;
  delivered: number;
  en_route: number;
  returned: number;
  open: number;
  prev_assigned: number;
  prev_delivered: number;
}

export interface TeamFunnel {
  market_id: string;
  from: string;
  to: string;
  prev_from: string;
  prev_to: string;
  tz: string;
  agents: FunnelAgent[];
}

export interface PanelProduct {
  product_id: string | null;
  name: string | null;
  image_url: string | null;
  assigned: number;
  uploaded: number;
  rejected: number;
  attempts: number;
}

export interface PanelCommission {
  currency: string | null;
  enabled: boolean;
  rate: number;
  rate_since: string | null;
  balance: number;
  earned: number;
  earned_n: number;
  back: number;
  back_n: number;
  paid: number;
  paid_n: number;
  entries: number;
  days: { day: string; net: number; paid: number }[];
  /** Net earned over those 14 days. */
  sum_14: number;
  in_flight: number;
  in_flight_late: number;
  /** In-flight parcels × today's rate: the most she may still earn from them. */
  coming: number;
  last_payout: { at: string; amount: number } | null;
}

export interface AgentPanel {
  market_id: string;
  agent_id: string;
  from: string;
  to: string;
  today: string;
  tz: string;
  products: PanelProduct[];
  rejections: { group: string; n: number }[];
  delivered_30: { delivered: number; returned: number; en_route: number };
  commission: PanelCommission;
}

export interface TeamAlertsMarket {
  market_id: string;
  call_delay_hours: number;
  idle_minutes: number;
  last_order_at: string | null;
  agents: {
    agent_id: string;
    name: string;
    uncalled: number;
    oldest_min: number | null;
    to_call: number;
    idle_since: string | null;
  }[];
}

export interface TeamAlerts {
  computed_at: string;
  markets: TeamAlertsMarket[];
}
