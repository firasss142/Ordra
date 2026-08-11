import type { SupabaseClient } from "@supabase/supabase-js";
import { fromCents, toCents } from "@/lib/calculations/math";
import { calculateNetProfit } from "@/lib/calculations/profitability";

type Supa = SupabaseClient;

export interface DailyPoint {
  /** UTC calendar day, ISO `YYYY-MM-DD`. */
  day: string;
  revenue: number;
  /** Revenue less COGS, delivery, return, packing and this day's ad-spend share. */
  net_profit: number;
  delivered_count: number;
}

export interface CohortFunnel {
  /** Orders created in the window. */
  leads: number;
  /** Of those, how many ever reached `confirmed`. */
  confirmed: number;
  /** Of those, how many ever reached `delivered`. */
  delivered: number;
}

// Cents (BIGINT) arrive from PostgREST as strings; Number() coerces them.
interface DailyRow {
  day: string;
  revenue_cents: number | string;
  cogs_cents: number | string;
  delivery_cost_cents: number | string;
  return_cost_cents: number | string;
  packing_cost_cents: number | string;
  delivered_count: number | string;
}

interface CohortRow {
  leads_count: number | string;
  confirmed_count: number | string;
  delivered_count: number | string;
}

/**
 * Spreads a period's ad spend across its days in whole cents.
 *
 * `ad_spend` rows carry a period, not a date — there is no daily granularity in
 * the data to recover, so an even split is the only allocation the source
 * supports. The remainder lands on the last day rather than being rounded away
 * on each, so `sum(daily) === period total` exactly and the sparkline cannot
 * disagree with the headline it sits under.
 */
export function allocateAdSpend(totalAdSpend: number, days: number): number[] {
  if (days <= 0) return [];
  const total = toCents(totalAdSpend);
  const base = Math.trunc(total / days);
  const out = new Array<number>(days).fill(base);
  out[days - 1] = total - base * (days - 1);
  return out;
}

/**
 * The per-day series behind the hero sparklines.
 *
 * Uses the same shared `calculateNetProfit` as the period figure, so the two
 * cannot drift apart: the RPC returns the same components the summary does,
 * bucketed by UTC day, and the ad-spend share is allocated exactly.
 */
export async function loadProfitabilityDaily(
  supabase: Supa,
  marketId: string,
  fromDate: string,
  toDate: string,
  periodAdSpend: number,
): Promise<DailyPoint[]> {
  const { data, error } = await supabase.rpc("get_profitability_daily", {
    p_market_id: marketId,
    p_from_date: fromDate,
    p_to_date: toDate,
  });

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as DailyRow[];
  const adPerDay = allocateAdSpend(periodAdSpend, rows.length);

  return rows.map((r, i) => {
    const revenue = fromCents(Number(r.revenue_cents));
    const netProfit = calculateNetProfit({
      revenue,
      cogs: fromCents(Number(r.cogs_cents)),
      deliveryCost: fromCents(Number(r.delivery_cost_cents)),
      returnCost: fromCents(Number(r.return_cost_cents)),
      packingCost: fromCents(Number(r.packing_cost_cents)),
      adSpend: fromCents(adPerDay[i] ?? 0),
    });
    return {
      day: r.day,
      revenue,
      net_profit: netProfit,
      delivered_count: Number(r.delivered_count),
    };
  });
}

/**
 * Leads → confirmed → delivered for one cohort: the orders created in the
 * window, followed forward.
 *
 * The page previously divided transitions counted in the window by orders
 * created in the window. Those are different sets — the orders delivered today
 * were confirmed weeks ago — which is how it came to publish a 1300%
 * confirmation rate. Following one cohort bounds both rates at 100% because
 * every order counted downstream is one of the leads counted upstream.
 */
export async function loadCohortFunnel(
  supabase: Supa,
  marketId: string,
  fromDate: string,
  toDate: string,
): Promise<CohortFunnel> {
  const { data, error } = await supabase
    .rpc("get_profitability_cohort_funnel", {
      p_market_id: marketId,
      p_from_date: fromDate,
      p_to_date: toDate,
    })
    .maybeSingle<CohortRow>();

  if (error) throw new Error(error.message);
  if (!data) return { leads: 0, confirmed: 0, delivered: 0 };

  return {
    leads: Number(data.leads_count),
    confirmed: Number(data.confirmed_count),
    delivered: Number(data.delivered_count),
  };
}
