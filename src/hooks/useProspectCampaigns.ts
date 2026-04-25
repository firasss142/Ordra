"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";

export interface ProspectCampaign {
  id: string;
  market_id: string;
  name: string;
  filter_json: {
    order_statuses?: string[];
    date_from?: string;
    date_to?: string;
    product_id?: string;
    city?: string;
  };
  created_by: string | null;
  created_at: string;
  leads_created?: number;
  leads_won?: number;
  conversion_rate?: number;
  total_ad_spend?: number | null;
  cost_per_conversion?: number | null;
}

export function useProspectCampaigns(params: {
  marketId: string | null;
  enabled?: boolean;
  includeAttribution?: boolean;
}) {
  const { marketId, enabled = true, includeAttribution = false } = params;
  const key =
    enabled && marketId
      ? `/api/leads/campaigns?market_id=${marketId}${includeAttribution ? "&include_attribution=true" : ""}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<{ data: ProspectCampaign[] }>(
    key,
    fetcher,
    { revalidateOnFocus: false }
  );

  return {
    campaigns: data?.data ?? [],
    error,
    isLoading,
    mutate,
  };
}
