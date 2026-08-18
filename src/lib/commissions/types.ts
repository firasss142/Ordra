/**
 * Wire types for agent commissions — the exact JSON shapes returned by the
 * `get_team_commissions`, `get_agent_commission_ledger`, `get_my_commissions`
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

/* ── agent-facing (`get_my_commissions`) ─────────────────────────────── */

export interface AgentHistoryOrder {
  external_id: string | null;
  product_name: string | null;
  city: string | null;
  amount: number;
  entry_type: "accrual" | "reversal";
}

export type AgentHistoryItem =
  | { type: "day"; day: string; delivered: number; corrections: number; amount: number; orders: AgentHistoryOrder[] }
  | { type: "payout"; at: string; amount: number; method: PayoutMethod | null; reference: string | null }
  | { type: "adjustment"; at: string; amount: number; note: string | null };

export interface AgentCommissions {
  enabled: boolean;
  currency: string;
  rate: number | null;
  balance: number;
  since_last_payout: { delivered: number; corrections: number };
  month: { delivered: number; earned: number };
  inflight: { count: number; est: number };
  last_payout: CommissionLastPayout | null;
  history: AgentHistoryItem[];
  has_more: boolean;
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
