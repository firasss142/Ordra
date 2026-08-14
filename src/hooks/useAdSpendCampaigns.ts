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
  /** Present when overlay=metrics: de-duplicated market-level counts. */
  meta?: { month_confirmed_count: number };
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
  /**
   * The realized-metrics overlay walks every entry against order_history in
   * Node. The console no longer renders per-entry ROAS — the economics route
   * computes it on a cohort basis instead — so opt out and skip the work.
   */
  withMetrics?: boolean;
}) {
  const withMetrics = params.withMetrics ?? true;
  const key = useMemo(() => {
    if (!params.marketId || !params.fromDate || !params.toDate) return null;
    const qs = new URLSearchParams({
      market_id: params.marketId,
      from_date: params.fromDate,
      to_date: params.toDate,
      scope: "all",
      include_products: "true",
    });
    if (withMetrics) qs.set("overlay", "metrics");
    return `/api/ad-spend?${qs.toString()}`;
  }, [params.marketId, params.fromDate, params.toDate, withMetrics]);

  const { data, error, isLoading, mutate } = useSWR<CampaignsResponse>(
    key,
    fetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );

  return {
    entries: data?.data ?? [],
    products: data?.products ?? [],
    monthConfirmedCount: data?.meta?.month_confirmed_count ?? null,
    isLoading,
    error,
    mutate,
  };
}
