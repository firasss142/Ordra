import useSWR from "swr";

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
  maturity_pct: number;
  spend: number;
  cpl: number;
  break_even_cpl: number;
  break_even_cost_per_delivered: number | null;
  break_even_roas: number | null;
  margin_per_lead: number;
  profit: number;
  roas: number | null;
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
  maturity_pct: number;
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
