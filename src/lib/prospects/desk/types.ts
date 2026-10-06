/**
 * The manager's Prospects desk — the contract between `get_prospect_desk`
 * (SQL, facts only) and the TypeScript that turns facts into the page.
 *
 * Design: prototypes/prospects-manager-v5.html. Plan: plans/prospects-recovery.md.
 *
 * Every figure the page shows is defined once, in SQL, and named here. If a
 * definition changes, it changes in the migration and in this comment — never
 * in a component.
 */

/** Where a prospect came from, as the page groups it. */
export type DeskSource = "rej" | "ret" | "old" | "camp";
export const DESK_SOURCES: DeskSource[] = ["rej", "ret", "old", "camp"];

/**
 * `leads.source` → the desk's four groups.
 *   rejected_order → rej  (won-back rejection, created by the daily tick)
 *   winback        → ret  (parcel on its way back, created by the order trigger)
 *   repeat_buyer   → old  (past buyer, N days after delivery, daily tick)
 *   anything else  → camp (lists, CSV, manual capture, social)
 */
export function sourceOf(leadSource: string): DeskSource {
  if (leadSource === "rejected_order") return "rej";
  if (leadSource === "winback") return "ret";
  if (leadSource === "repeat_buyer") return "old";
  return "camp";
}

/** Where a prospect stands. Derived from `leads.status` + `converted_order_id`. */
export type DeskState = "to_call" | "in_progress" | "won" | "lost";

export function stateOf(status: string, convertedOrderId: string | null): DeskState {
  if (convertedOrderId || status === "won") return "won";
  if (status === "lost" || status === "archived") return "lost";
  if (status === "new" || status === "assigned") return "to_call";
  return "in_progress";
}

/** Per-market rules, settings key `prospect_recovery`. Defaults live in SQL. */
export interface RecoverySettings {
  enabled: boolean;
  rej: { on: boolean; delay_days: number; subreasons: string[] };
  ret: { on: boolean };
  old: { on: boolean; after_days: number };
  dist: { hour: number; file_cap: number; release_days: number; max_tries: number };
}

/** One source card, over prospects CREATED in the month. Delivered/revenue: see DeskFacts.hero. */
export interface SourceFacts {
  key: DeskSource;
  created: number;
  to_call: number;
  in_progress: number;
  won: number;
  lost: number;
  /** Orders brought back by this source and DELIVERED in the month (by delivered date). */
  delivered: number;
  /** Their orders.total_price. Sums across sources to hero.revenue. */
  revenue: number;
}

export interface AgentFacts {
  id: string;
  name: string;
  /** users.color key (indigo, pink, cyan, gold, lime, orange) or null. */
  color: string | null;
  last_seen_at: string | null;
  /** Has a share in agent_distribution_shares (or the market has no shares at all). */
  in_rotation: boolean;
  /** Open prospects assigned to her right now. */
  file_open: number;
  /** Distinct prospects she logged a call outcome on today (market-local day). */
  called_today: number;
  late_callbacks: number;
  /** Open, assigned to her, nothing logged for `dist.release_days` days. */
  stale: number;
  converted_month: number;
  delivered_month: number;
  revenue_month: number;
}

export interface DeskFacts {
  generated_at: string;
  month: { from: string; to: string };
  settings: RecoverySettings;
  /** Last time the daily tick distributed in this market, or null. */
  last_tick_at: string | null;
  hero: {
    /** Orders created from a prospect and delivered in the month (delivered date). */
    delivered: number;
    revenue: number;
    /** Orders created from a prospect during the month, any status. */
    converted: number;
    on_road: number;
    not_shipped: number;
    returned: number;
    prev_delivered: number;
  };
  sources: SourceFacts[];
  agents: AgentFacts[];
  /** Open prospects with no agent. */
  pool: { open: number; oldest_days: number | null };
  /** Every open prospect in the market. */
  open_total: number;
}
