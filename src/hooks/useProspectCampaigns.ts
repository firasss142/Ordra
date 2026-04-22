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
}

export function useProspectCampaigns(params: {
  marketId: string | null;
  enabled?: boolean;
}) {
  const { marketId, enabled = true } = params;
  const key =
    enabled && marketId
      ? `/api/leads/campaigns?market_id=${marketId}`
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
