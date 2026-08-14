"use client";

import useSWR from "swr";

/** One Meta campaign, rolled up over the selected window. */
export interface MetaCampaign {
  external_campaign_id: string;
  campaign_name: string | null;
  ad_account_id: string | null;
  product_id: string | null;
  spend: number;
  impressions: number;
  clicks: number;
  platform_results: number;
  days: number;
  first_day: string;
  last_day: string;
}

interface CampaignsResponse {
  data: MetaCampaign[];
  meta: { unmapped_count: number; unmapped_spend: number };
}

const fetcher = async (url: string): Promise<CampaignsResponse> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`meta campaigns ${res.status}`);
  return res.json();
};

export function useMetaCampaigns(params: {
  marketId: string;
  fromDate: string;
  toDate: string;
  /** Skip the request entirely until the drawer is actually opened. */
  enabled?: boolean;
}) {
  const enabled = params.enabled ?? true;
  const key =
    enabled && params.marketId
      ? `/api/meta/campaigns?market_id=${params.marketId}&from_date=${params.fromDate}&to_date=${params.toDate}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<CampaignsResponse>(key, fetcher, {
    revalidateOnFocus: false,
    keepPreviousData: true,
  });

  return {
    campaigns: data?.data ?? [],
    unmappedCount: data?.meta?.unmapped_count ?? 0,
    unmappedSpend: data?.meta?.unmapped_spend ?? 0,
    isLoading,
    error,
    mutate,
  };
}
