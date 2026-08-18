/**
 * Pure view-model helpers for agent commissions. SQL supplies the counts and
 * the ledger fold; this file supplies the verdicts the pages render — what is
 * "à payer", which balances are debts, how a payout would land — so there is
 * one place to change a rule and one place to test it.
 */
import { formatCurrency } from "@/lib/format";
import type { CommissionAgent, TeamCommissions } from "./types";

export type BalanceTone = "positive" | "negative" | "zero";

export interface CommissionAgentView {
  agent: CommissionAgent;
  tone: BalanceTone;
  /** commission switched off for this agent (or the whole market) */
  disabled: boolean;
  /** no rule exists at all for the market yet — nothing was ever switched off */
  unconfigured: boolean;
}

export interface CommissionTotals {
  delivered: number;
  earned: number;
  paid: number;
  /** net of every balance, debts included */
  balance: number;
  /** Σ of positive balances only — what the company would hand out today */
  to_pay_sum: number;
  to_pay_count: number;
  negative_count: number;
}

export interface CommissionView {
  agents: CommissionAgentView[];
  byId: Record<string, CommissionAgentView>;
  totals: CommissionTotals;
  currency: string;
}

export function balanceTone(balance: number): BalanceTone {
  if (balance > 0) return "positive";
  if (balance < 0) return "negative";
  return "zero";
}

export function buildCommissionView(tc: TeamCommissions): CommissionView {
  const unconfigured = tc.market === null;
  const marketOff = tc.market ? !tc.market.enabled : true;
  const agents: CommissionAgentView[] = tc.agents.map((agent) => ({
    agent,
    tone: balanceTone(agent.balance),
    disabled: marketOff || !agent.rate.enabled,
    unconfigured,
  }));
  agents.sort((x, y) => {
    if (x.disabled !== y.disabled) return x.disabled ? 1 : -1;
    if (y.agent.earned !== x.agent.earned) return y.agent.earned - x.agent.earned;
    return x.agent.name.localeCompare(y.agent.name);
  });
  const byId: Record<string, CommissionAgentView> = {};
  agents.forEach((a) => { byId[a.agent.agent_id] = a; });

  const positives = agents.filter((a) => a.agent.balance > 0);
  const totals: CommissionTotals = {
    delivered: tc.team.delivered,
    earned: tc.team.earned,
    paid: tc.team.paid,
    balance: tc.team.balance,
    to_pay_sum: positives.reduce((s, a) => s + a.agent.balance, 0),
    to_pay_count: positives.length,
    negative_count: agents.filter((a) => a.agent.balance < 0).length,
  };
  return { agents, byId, totals, currency: tc.currency };
}

export function balanceAfterPayout(balance: number, amount: number): number {
  return Math.round((balance - amount) * 1000) / 1000;
}

/** A payment that leaves the agent owing the company needs an explicit confirm. */
export function payoutCrossesZero(balance: number, amount: number): boolean {
  return balanceAfterPayout(balance, amount) < 0;
}

/**
 * Money for the commission surfaces. Rates and payouts are almost always whole
 * dinars, and "29 500,000 د.ل." three times per row is noise — so whole
 * amounts drop the millimes and only fractional ones keep the three digits.
 * Same bidi-safe composition as everything else (formatCurrency).
 */
export function fmtCommission(amount: number, market: string, opts?: { signed?: boolean }): string {
  const whole = Number.isInteger(Math.round(amount * 1000) / 1000) && Number.isInteger(amount);
  return formatCurrency(amount, market, { signed: opts?.signed ?? false, fractionDigits: whole ? 0 : 3 });
}
