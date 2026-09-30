/**
 * Wire types for agent commissions — the exact JSON shapes returned by the
 * `get_team_commissions`, `get_agent_commission_ledger`, `get_my_commission_statement`
 * and `get_commission_settings` RPCs (supabase/migrations/20260918010002_
 * agent_commissions_rpcs.sql). Keep in step with the SQL; nothing else in the
 * app may guess at these payloads.
 *
 * Money is in the market currency, NUMERIC(·,3) — millimes for TND and LYD.
 */

export type CommissionEntryType = "accrual" | "reversal" | "payout" | "adjustment";
export type PayoutMethod = "cash" | "bank_transfer" | "wallet";
export const PAYOUT_METHODS: readonly PayoutMethod[] = ["cash", "bank_transfer", "wallet"];

/** The rate that applies to an agent today, after market ∘ agent resolution. */
export interface CommissionRate {
  amount: number;
  enabled: boolean;
  /** true when an agent-specific row (not the market default) is in force */
  is_override: boolean;
  effective_from: string | null;
}

export interface CommissionLastPayout {
  at: string;
  amount: number;
  method: PayoutMethod | null;
}

export interface CommissionAgent {
  agent_id: string;
  name: string;
  avatar_url: string | null;
  is_active: boolean;
  rate: CommissionRate;
  /** period-scoped */
  delivered: number;
  earned: number;
  paid: number;
  /** orders whose last confirm is this agent's and that sit between uploaded and in_transit */
  pending_count: number;
  pending_est: number;
  /** all-time fold of the ledger: > 0 company owes agent, < 0 agent owes company */
  balance: number;
  /** all-time Σ accrual + reversal + adjustment */
  earned_total: number;
  /** all-time Σ payouts (positive number) */
  paid_total: number;
  last_payout: CommissionLastPayout | null;
}

export interface TeamCommissions {
  market_id: string;
  currency: string;
  from: string;
  to: string;
  tz: string;
  market: { enabled: boolean; amount: number; effective_from: string | null } | null;
  agents: CommissionAgent[];
  team: { delivered: number; earned: number; paid: number; balance: number };
}

export interface CommissionLedgerEntry {
  id: string;
  entry_type: CommissionEntryType;
  amount: number;
  rate_amount: number | null;
  effective_at: string;
  method: PayoutMethod | null;
  reference: string | null;
  note: string | null;
  order_id: string | null;
  external_id: string | null;
  product_name: string | null;
  created_by_name: string | null;
  created_at: string;
}

/* ── agent-facing (`get_my_commission_statement`, 20260930192800) ─────── */

/** Where an in-flight parcel is — `commission_order_stage()` in SQL. */
export type StatementStage = "awaiting_scan" | "with_carrier" | "out" | "delayed" | "returning";
export const STATEMENT_STAGES: readonly StatementStage[] = ["awaiting_scan", "with_carrier", "out", "delayed", "returning"];

/** Why a confirmed order earned nothing. */
export type LostReason =
  | "carrier_cancelled" | "cancelled" | "rejected" | "returned"
  | "before_activation" | "commission_off" | "corrected";
export const LOST_REASONS: readonly LostReason[] = [
  "carrier_cancelled", "cancelled", "rejected", "returned", "before_activation", "commission_off", "corrected",
];

interface StatementOrder {
  order_id: string | null;
  external_id: string | null;
  customer_name: string | null;
  product_name: string | null;
  image_url: string | null;
  city: string | null;
}

/** A delivered order (or an adjustment) that earned money — paid or not. */
export interface StatementCredit extends StatementOrder {
  kind: "accrual" | "adjustment";
  note: string | null;
  /** delivery time (the accrual's effective_at) */
  at: string;
  /** what is still owed on it (unpaid) or what it earned (paid) */
  amount: number;
  full_amount: number;
  /** unpaid only: the last payout covered part of it; `amount` is the remainder */
  partial?: boolean;
  /** paid only: settled across two payouts, finished by this one */
  split?: boolean;
}

export interface StatementPayout {
  at: string;
  amount: number;
  method: PayoutMethod | null;
  reference: string | null;
  /** delivered orders this payout finished settling (FIFO) */
  count: number;
  from: string | null;
  to: string | null;
  has_split: boolean;
  /** older than the window: counted, rows not sent */
  rows_omitted: boolean;
  rows: StatementCredit[];
}

export interface StatementWayRow extends StatementOrder {
  stage: StatementStage;
  uploaded_at: string | null;
  stage_at: string | null;
}

export interface StatementLostRow extends StatementOrder {
  reason: LostReason;
  at: string | null;
  uploaded_at: string | null;
  /** what it had earned before it was taken back, if it ever did */
  was_amount: number | null;
}

export interface AgentStatement {
  enabled: boolean;
  currency: string;
  rate: {
    amount: number | null;
    effective_from: string | null;
    /** set for a week after a change, so « 10 (avant 9) » can be said */
    previous_amount: number | null;
    off_since: string | null;
  };
  activated_on: string | null;
  /** window start (market-local date): max(activation, today − days) */
  since: string;
  /** Σ credits — owed = earned − paid, always */
  earned: number;
  paid: number;
  owed: number;
  last_payout: CommissionLastPayout | null;
  /** Σ rows.amount = owed when owed > 0 */
  unpaid: { count: number; amount: number; rows: StatementCredit[] };
  paid_orders: { count: number; amount: number; payouts: StatementPayout[] };
  way: {
    count: number;
    est: number;
    est_likely: number | null;
    stages: Record<StatementStage, number>;
    rows: StatementWayRow[];
  };
  lost: { count: number; rows: StatementLostRow[] } & Record<LostReason, number>;
  funnel: {
    confirmed: number;
    delivered: number;
    way: number;
    lost: number;
    awaiting_upload: number;
    back_in_queue: number;
  };
  /** delivered ÷ (delivered + finished without delivery), 0..1 */
  delivery_rate: number | null;
}

/* ── settings (`get_commission_settings`) ─────────────────────────────── */

export interface CommissionRateRow {
  id: string;
  agent_id: string | null;
  enabled: boolean;
  amount: number;
  effective_from: string;
  effective_to: string | null;
  note: string | null;
  set_by_name: string | null;
  created_at: string;
}

export interface CommissionSettings {
  market_id: string;
  currency: string;
  market: CommissionRateRow | null;
  agents: {
    agent_id: string;
    name: string;
    avatar_url: string | null;
    is_active: boolean;
    override: CommissionRateRow | null;
  }[];
  history: (CommissionRateRow & { agent_name: string | null })[];
}
