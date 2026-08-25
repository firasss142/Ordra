import { createHash } from "node:crypto";
import { fromMillimes, toMillimes } from "@/lib/calculations/math";
import type { DealAccrualResult } from "./accrual";
import { addDaysISO } from "./facts/ad-spend-daily";
import type { DealRow } from "./load-accrual";
import { termsOn, type TermsVersion } from "./terms";

/**
 * Statement draft = the accrual at cutoff `period_end`, expressed as a period
 * DELTA against the previous statement (delta method), plus the idempotency
 * hash. period_start is DERIVED (last period_end + 1, or the deal start) —
 * never chosen by the admin, so periods are contiguous by construction.
 *
 * `preview_hash` covers every figure that decides money plus the facts
 * watermark; the commit route recomputes and refuses (409) if it moved.
 */

export type StatementKind = "periodic" | "final";

export interface StatementDraft {
  deal_id: string;
  kind: StatementKind;
  period_start: string;
  period_end: string;
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  processing_cost: number;
  ad_spend_direct: number;
  gross_profit: number;
  net_profit: number;
  received_count: number;
  uploaded_count: number;
  delivered_count: number;
  returned_count: number;
  excluded_dexpress_count: number;
  pending_count: number;
  pending_revenue: number;
  share_pct_min: number;
  share_pct_max: number;
  investor_share: number;
  restatement_delta: number;
  carried_loss_before: number;
  carried_loss_applied: number;
  carried_loss_after: number;
  payable: number;
  cumulative_share_through: number;
  cumulative_net_profit_through: number;
  capital_amount: number;
  snapshot: Record<string, unknown>;
  preview_hash: string;
  warnings: StatementWarning[];
}

export interface StatementWarning {
  code: "PENDING_ORDERS" | "IN_FLIGHT" | "NEGATIVE_PERIOD" | "RESTATEMENT" | "NO_MOVEMENT" | "DEXPRESS_EXCLUDED";
  detail: string;
  count?: number;
  amount?: number;
}

export interface PriorStatementLite {
  periodEnd: string;
  cumulativeShareThrough: number;
  cumulativeNetProfitThrough: number;
  carriedLossAfter: number;
}

export function derivePeriodStart(deal: DealRow, prior: PriorStatementLite[]): string {
  if (!prior.length) return deal.start_date;
  const last = [...prior].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1))[prior.length - 1];
  return addDaysISO(last.periodEnd, 1);
}

export function validatePeriodEnd(params: {
  deal: DealRow;
  periodStart: string;
  periodEnd: string;
  todayDate: string;
  kind: StatementKind;
}): null | "PERIOD_END_BEFORE_START" | "PERIOD_END_IN_FUTURE" | "PERIOD_END_AFTER_DEAL_END" {
  const { deal, periodStart, periodEnd, todayDate, kind } = params;
  if (periodEnd < periodStart) return "PERIOD_END_BEFORE_START";
  if (periodEnd > todayDate) return "PERIOD_END_IN_FUTURE";
  if (kind === "periodic" && periodEnd > deal.end_date) return "PERIOD_END_AFTER_DEAL_END";
  return null;
}

export function previewHash(parts: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

export function buildStatementDraft(params: {
  deal: DealRow;
  terms: TermsVersion[];
  accrual: DealAccrualResult; // computed with cutoffDate = periodEnd
  prior: PriorStatementLite[];
  periodEnd: string;
  kind: StatementKind;
  factsWatermark: string | null;
  rollupRunId?: string | null;
}): StatementDraft {
  const { deal, terms, accrual, prior, periodEnd, kind } = params;
  const periodStart = derivePeriodStart(deal, prior);
  const last = prior.length ? [...prior].sort((a, b) => (a.periodEnd < b.periodEnd ? -1 : 1))[prior.length - 1] : null;

  // Period figures = totals through periodEnd minus totals through last period_end.
  // The accrual's `days` are the per-day series since deal start; sum the days
  // strictly after last.periodEnd (restatements on older days are counted in
  // investor_share via the delta method, and reported separately).
  const inPeriod = accrual.days.filter((d) => d.d >= periodStart && d.d <= periodEnd);
  const sum = (k: keyof (typeof inPeriod)[number]) => inPeriod.reduce((a, r) => a + toMillimes(Number(r[k])), 0);
  const revenue = sum("rev"),
    cogs = sum("cogs"),
    dlv = sum("dlv"),
    ret = sum("ret"),
    pack = sum("pack"),
    proc = sum("proc"),
    ads = sum("ads");
  const gross = revenue - cogs - dlv - ret;
  const net = gross - pack - proc - ads;

  const pcts = inPeriod.map((d) => d.pct).filter((p) => p > 0);
  const shareMin = pcts.length ? Math.min(...pcts) : (termsOn(terms, periodEnd)?.sharePct ?? 0);
  const shareMax = pcts.length ? Math.max(...pcts) : shareMin;

  const investorShare = toMillimes(accrual.unsettledShare);
  const cumulativeShareThrough = toMillimes(accrual.cumulativeShare);
  const cumulativeNetThrough = (last ? toMillimes(last.cumulativeNetProfitThrough) : 0) + net + toMillimes(accrual.restatementDelta) * 0; // net-profit through = prior + period net (restatement of net is folded into the day series already)
  const cumNetFromDays = accrual.days.filter((d) => d.d <= periodEnd).reduce((a, r) => a + toMillimes(r.net), 0);

  const termsAtEnd = termsOn(terms, periodEnd);
  const capital = termsAtEnd?.capitalAmount ?? 0;

  const warnings: StatementWarning[] = [];
  if (accrual.pending.count > 0)
    warnings.push({ code: "PENDING_ORDERS", detail: `${accrual.pending.count} outcome(s) awaiting carrier billing — not counted`, count: accrual.pending.count, amount: accrual.pending.revenueGross });
  if (accrual.inFlight.count > 0)
    warnings.push({ code: "IN_FLIGHT", detail: `${accrual.inFlight.count} parcel(s) in flight`, count: accrual.inFlight.count, amount: accrual.inFlight.expectedShare });
  if (investorShare < 0) warnings.push({ code: "NEGATIVE_PERIOD", detail: "negative period — carried loss increases, nothing payable", amount: fromMillimes(investorShare) });
  if (Math.abs(toMillimes(accrual.restatementDelta)) > 0)
    warnings.push({ code: "RESTATEMENT", detail: "already-settled days moved (late returns / late billing / ad restatement)", amount: accrual.restatementDelta });
  if (investorShare === 0 && net === 0) warnings.push({ code: "NO_MOVEMENT", detail: "no money moved in this period" });
  if (accrual.counts.excludedDexpress > 0)
    warnings.push({ code: "DEXPRESS_EXCLUDED", detail: `${accrual.counts.excludedDexpress} Dexpress-carried orders excluded (no billing feed)`, count: accrual.counts.excludedDexpress });

  const hashParts = {
    deal_id: deal.id,
    kind,
    period_start: periodStart,
    period_end: periodEnd,
    cumulative_share_through: fromMillimes(cumulativeShareThrough),
    investor_share: fromMillimes(investorShare),
    payable: accrual.payableNow,
    carried_loss_after: accrual.carriedLossAfter,
    net_profit: fromMillimes(net),
    ad_spend: fromMillimes(ads),
    facts_watermark: params.factsWatermark,
    terms: terms.map((t) => t.id ?? `${t.effectiveFrom}:${t.sharePct}`),
    prev_statement_end: last?.periodEnd ?? null,
  };

  void cumulativeNetThrough;

  return {
    deal_id: deal.id,
    kind,
    period_start: periodStart,
    period_end: periodEnd,
    revenue: fromMillimes(revenue),
    cogs: fromMillimes(cogs),
    delivery_cost: fromMillimes(dlv),
    return_cost: fromMillimes(ret),
    packing_cost: fromMillimes(pack),
    processing_cost: fromMillimes(proc),
    ad_spend_direct: fromMillimes(ads),
    gross_profit: fromMillimes(gross),
    net_profit: fromMillimes(net),
    received_count: accrual.counts.received,
    uploaded_count: accrual.counts.uploaded,
    delivered_count: accrual.counts.delivered,
    returned_count: accrual.counts.returned,
    excluded_dexpress_count: accrual.counts.excludedDexpress,
    pending_count: accrual.pending.count,
    pending_revenue: accrual.pending.revenueGross,
    share_pct_min: shareMin,
    share_pct_max: shareMax,
    investor_share: fromMillimes(investorShare),
    restatement_delta: accrual.restatementDelta,
    carried_loss_before: accrual.carriedLossBefore,
    carried_loss_applied: accrual.lossApplied,
    carried_loss_after: accrual.carriedLossAfter,
    payable: accrual.payableNow,
    cumulative_share_through: fromMillimes(cumulativeShareThrough),
    cumulative_net_profit_through: fromMillimes(cumNetFromDays),
    capital_amount: capital,
    snapshot: {
      days: inPeriod,
      totals_through: accrual.totals,
      yours_through: accrual.yours,
      terms_versions: terms,
      facts_watermark: params.factsWatermark,
      rollup_run_id: params.rollupRunId ?? null,
      prev_statement_end: last?.periodEnd ?? null,
      excluded: { dexpress: accrual.counts.excludedDexpress, deleted: accrual.counts.excludedDeleted },
      in_flight: accrual.inFlight,
      pending: accrual.pending,
      rates: accrual.rates,
      computed_at: new Date().toISOString(),
    },
    preview_hash: previewHash(hashParts),
    warnings,
  };
}
