import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { fromCents } from "@/lib/calculations/math";
import {
  calculateNetProfit,
  calculateMargin,
} from "@/lib/calculations/profitability";

export interface ProfitabilitySummary {
  revenue: number;
  cogs: number;
  delivery_cost: number;
  return_cost: number;
  packing_cost: number;
  ad_spend: number;
  net_profit: number;
  margin: number;
  delivered_count: number;
  returned_count: number;
  confirmed_count: number;
  leads_count: number;
}

type Supa = SupabaseClient;

// Shape returned by the get_profitability_summary RPC. All monetary values are
// integer cents (BIGINT), which PostgREST serializes as strings — Number()
// coerces them. Counts come back as numbers.
interface ProfitabilityAggRow {
  revenue_cents: number | string;
  cogs_cents: number | string;
  delivery_cost_cents: number | string;
  return_cost_cents: number | string;
  packing_cost_cents: number | string;
  delivered_count: number | string;
  returned_count: number | string;
  confirmed_count: number | string;
}

const ZERO_AGG: ProfitabilityAggRow = {
  revenue_cents: 0,
  cogs_cents: 0,
  delivery_cost_cents: 0,
  return_cost_cents: 0,
  packing_cost_cents: 0,
  delivered_count: 0,
  returned_count: 0,
  confirmed_count: 0,
};

// Aggregates the market P&L in the database via the get_profitability_summary
// RPC (SECURITY DEFINER) instead of pulling every delivered/returned/confirmed
// order_history row through the per-row RLS policy and summing in Node. The old
// approach timed out under the market_manager role for any window wider than
// ~1 week (the order_history_select RLS EXISTS subquery is evaluated per row);
// the RPC does the same aggregation in one indexed pass (~20ms) and returns
// byte-identical numbers. Ad spend and the leads count stay as direct queries,
// and net_profit/margin are still computed by the shared JS calculators.
export async function loadProfitabilitySummary(
  supabase: Supa,
  marketId: string,
  fromDate: string,
  toDate: string,
): Promise<ProfitabilitySummary> {
  const dateLte = toDate + "T23:59:59.999Z";

  const [aggResult, leadsResult, adSpendRows] = await Promise.all([
    supabase
      .rpc("get_profitability_summary", {
        p_market_id: marketId,
        p_from_date: fromDate,
        p_to_date: dateLte,
      })
      .maybeSingle<ProfitabilityAggRow>(),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("market_id", marketId)
      .gte("created_at", fromDate)
      .lte("created_at", dateLte),
    // Paged deliberately. Ad spend is stored per campaign per day, so ten live
    // campaigns cross PostgREST's 1000-row cap in about a hundred days and a
    // plain select would start silently returning a prefix. The failure is the
    // worst kind: understated spend inflates net profit and every investor
    // share that hangs off it, with no error anywhere to notice.
    fetchAllRows<{ amount: number | string }>(
      supabase
        .from("ad_spend")
        .select("amount")
        .eq("market_id", marketId)
        // Total ad spend = ALL active entries (market-wide AND product-scoped);
        // product-scoped spend is real market spend. Same definition as the
        // ad-spend page rollups — the two surfaces must agree.
        .eq("is_active", true)
        .lte("period_start", toDate)
        .gte("period_end", fromDate)
        // A total order is required: .range() paging over ties is OFFSET/LIMIT
        // over an unordered relation, which Postgres does not promise is stable
        // between statements. A repeated or skipped row here is a wrong sum, and
        // this one feeds money.
        .order("id", { ascending: true }),
    ),
  ]);

  if (aggResult.error) throw new Error(aggResult.error.message);
  const agg = aggResult.data ?? ZERO_AGG;

  const revenue = fromCents(Number(agg.revenue_cents));
  const cogs = fromCents(Number(agg.cogs_cents));
  const deliveryCost = fromCents(Number(agg.delivery_cost_cents));
  const returnCost = fromCents(Number(agg.return_cost_cents));
  const packingCost = fromCents(Number(agg.packing_cost_cents));

  const adSpend = adSpendRows.reduce((sum, r) => sum + Number(r.amount), 0);

  const netProfit = calculateNetProfit({
    revenue,
    cogs,
    deliveryCost,
    returnCost,
    packingCost,
    adSpend,
  });
  const margin = calculateMargin(netProfit, revenue);

  return {
    revenue,
    cogs,
    delivery_cost: deliveryCost,
    return_cost: returnCost,
    packing_cost: packingCost,
    ad_spend: adSpend,
    net_profit: netProfit,
    margin,
    delivered_count: Number(agg.delivered_count),
    returned_count: Number(agg.returned_count),
    confirmed_count: Number(agg.confirmed_count),
    leads_count: leadsResult.count ?? 0,
  };
}
