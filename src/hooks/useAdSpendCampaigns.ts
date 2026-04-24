"use client";

import { useMemo } from "react";
import useSWR from "swr";
import type { AdSpendWithMetrics } from "@/lib/ad-spend/realized-metrics";

export interface CampaignsProduct {
  id: string;
  name: string;
}

interface CampaignsResponse {
  data: AdSpendWithMetrics[];
  products?: CampaignsProduct[];
}

const fetcher = async (url: string): Promise<CampaignsResponse> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`ad_spend ${res.status}`);
  return res.json();
};

export function useAdSpendCampaigns(params: {
  marketId: string;
  fromDate: string;
  toDate: string;
}) {
  const key = useMemo(() => {
    if (!params.marketId || !params.fromDate || !params.toDate) return null;
    const qs = new URLSearchParams({
      market_id: params.marketId,
      from_date: params.fromDate,
      to_date: params.toDate,
      overlay: "metrics",
      scope: "all",
      include_products: "true",
    });
    return `/api/ad-spend?${qs.toString()}`;
  }, [params.marketId, params.fromDate, params.toDate]);

  const { data, error, isLoading, mutate } = useSWR<CampaignsResponse>(
    key,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  return {
    entries: data?.data ?? [],
    products: data?.products ?? [],
    isLoading,
    error,
    mutate,
  };
}
