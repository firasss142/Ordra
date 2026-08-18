import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { computeDealAccrual, type DealAccrualInput, type DealAccrualResult, type DealStatus } from "./accrual";
import { adSpendByDayForProduct, type AdSpendRow } from "./facts/ad-spend-daily";
import type { OrderFactRow } from "./facts/order-facts";
import type { PayoutCadence, TermsVersion } from "./terms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supa = SupabaseClient<any, any, any>;

export interface DealRow {
  id: string;
  investor_id: string;
  product_id: string;
  market_id: string;
  currency: string;
  label: string | null;
  start_date: string;
  end_date: string;
  status: DealStatus;
  close_reason: string | null;
  closed_at: string | null;
}

export interface TermsRow {
  id: string;
  deal_id: string;
  effective_from: string;
  share_pct: string | number;
  capital_amount: string | number;
  payout_cadence: PayoutCadence;
  maturity_date: string;
}

export function termsRowToVersion(t: TermsRow): TermsVersion {
  return {
    id: t.id,
    effectiveFrom: t.effective_from,
    sharePct: Number(t.share_pct),
    capitalAmount: Number(t.capital_amount),
    payoutCadence: t.payout_cadence,
    maturityDate: t.maturity_date,
  };
}

/** Prior statements for the delta method (ascending by period_end). */
export async function loadPriorStatements(
  admin: Supa,
  dealId: string,
): Promise<{ periodEnd: string; cumulativeShareThrough: number; cumulativeNetProfitThrough: number; carriedLossAfter: number }[]> {
  const rows = await fetchAllRows<{ period_end: string; cumulative_share_through: string | number; cumulative_net_profit_through: string | number; carried_loss_after: string | number }>(
    admin
      .from("investor_deal_statements")
      .select("period_end, cumulative_share_through, cumulative_net_profit_through, carried_loss_after")
      .eq("deal_id", dealId)
      .order("period_end", { ascending: true }),
  );
  return rows.map((r) => ({
    periodEnd: r.period_end,
    cumulativeShareThrough: Number(r.cumulative_share_through),
    cumulativeNetProfitThrough: Number(r.cumulative_net_profit_through),
    carriedLossAfter: Number(r.carried_loss_after),
  }));
}

export async function loadDealTerms(admin: Supa, dealId: string): Promise<TermsVersion[]> {
  const rows = await fetchAllRows<TermsRow>(
    admin
      .from("investor_deal_terms")
      .select("id, deal_id, effective_from, share_pct, capital_amount, payout_cadence, maturity_date")
      .eq("deal_id", dealId)
      .order("effective_from", { ascending: true }),
  );
  return rows.map(termsRowToVersion);
}

export async function loadDealAccrualInput(
  admin: Supa,
  deal: DealRow,
  cutoffDate: string,
  todayDate: string,
): Promise<DealAccrualInput> {
  const [terms, facts, ads, priorStatements] = await Promise.all([
    loadDealTerms(admin, deal.id),
    fetchAllRows<OrderFactRow>(
      admin
        .from("investor_order_facts")
        .select("*")
        .eq("product_id", deal.product_id)
        .gte("cohort_date", deal.start_date)
        .lte("cohort_date", deal.end_date),
    ),
    fetchAllRows<{ product_id: string | null; amount: string | number; period_start: string; period_end: string }>(
      admin
        .from("ad_spend")
        .select("product_id, amount, period_start, period_end")
        .eq("product_id", deal.product_id)
        .eq("is_active", true)
        .lte("period_start", cutoffDate)
        .gte("period_end", deal.start_date),
    ),
    loadPriorStatements(admin, deal.id),
  ]);

  const adRows: AdSpendRow[] = ads.map((a) => ({
    productId: a.product_id,
    amount: Number(a.amount),
    periodStart: a.period_start,
    periodEnd: a.period_end,
  }));
  const end = cutoffDate < deal.end_date ? cutoffDate : deal.end_date;

  return {
    deal: { id: deal.id, startDate: deal.start_date, endDate: deal.end_date, status: deal.status },
    terms,
    cutoffDate,
    facts,
    adSpendByDay: adSpendByDayForProduct(adRows, deal.product_id, { from: deal.start_date, to: end }),
    priorStatements,
    todayDate,
  };
}

export async function computeDealAccrualLive(
  admin: Supa,
  deal: DealRow,
  cutoffDate: string,
  todayDate: string,
): Promise<{ input: DealAccrualInput; result: DealAccrualResult; factsWatermark: string | null }> {
  const input = await loadDealAccrualInput(admin, deal, cutoffDate, todayDate);
  const result = computeDealAccrual(input);
  let watermark: string | null = null;
  for (const f of input.facts as (OrderFactRow & { updated_at?: string })[]) {
    if (f.updated_at && (!watermark || f.updated_at > watermark)) watermark = f.updated_at;
  }
  return { input, result, factsWatermark: watermark };
}
