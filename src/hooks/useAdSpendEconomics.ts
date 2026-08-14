import useSWR from "swr";

/** One `ad_spend` row shown as a campaign sub-row under its product. */
export interface SpendEntry {
  id: string;
  label: string | null;
  campaign_id: string | null;
  source: string;
  amount: number;
  period_start: string;
  period_end: string;
  editable: boolean;
}

/** One product's acquisition economics over the selected cohort. */
export interface ProductEconomics {
  product_id: string;
  product_name: string;
  leads: number;
  confirmed: number;
  delivered: number;
  returned: number;
  revenue: number;
  aov: number;
  delivery_rate: number;
  confirm_rate: number;
  return_rate: number;
  maturity_pct: number;
  cost_cogs: number;
  cost_delivery: number;
  cost_returns: number;
  cost_packing: number;
  cost_processing: number;
  spend: number;
  cpl: number;
  break_even_cpl: number;
  break_even_cost_per_delivered: number | null;
  break_even_roas: number | null;
  break_even_delivery_rate: number | null;
  margin_per_lead: number;
  profit: number;
  roas: number | null;
  daily_leads: number[];
  entries: SpendEntry[];
}

export interface EconomicsMeta {
  market_level_spend: number;
  total_spend: number;
  total_leads: number;
  total_confirmed: number;
  total_delivered: number;
  total_revenue: number;
  total_costs: number;
  total_profit: number;
  cost_cogs: number;
  cost_delivery: number;
  cost_returns: number;
  cost_packing: number;
  cost_processing: number;
  maturity_pct: number;
  unmapped: { spend: number; entries: SpendEntry[] };
  from_date: string;
  to_date: string;
}

interface EconomicsResponse {
  data: ProductEconomics[];
  meta: EconomicsMeta;
}

const fetcher = async (url: string): Promise<EconomicsResponse> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
};

export function useAdSpendEconomics(params: {
  marketId: string;
  fromDate: string;
  toDate: string;
}) {
  const key = params.marketId
    ? `/api/ad-spend/economics?market_id=${params.marketId}&from_date=${params.fromDate}&to_date=${params.toDate}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<EconomicsResponse>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return {
    products: data?.data ?? [],
    meta: data?.meta ?? null,
    isLoading,
    error,
    mutate,
  };
}
