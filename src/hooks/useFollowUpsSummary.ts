"use client";

import useSWR from "swr";
import type { FollowUpsSummary } from "@/lib/follow-ups/summary";

const fetcher = async (url: string): Promise<FollowUpsSummary> => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`follow-ups summary ${res.status}`);
  const json = await res.json();
  return json.data as FollowUpsSummary;
};

export interface UseFollowUpsSummaryOptions {
  marketId: string | null;
  agentId: string | null;
  campaignId: string | null;
  /** SSR-prefetched summary for zero client-side loading on first paint. */
  fallback?: FollowUpsSummary;
}

export function useFollowUpsSummary(opts: UseFollowUpsSummaryOptions) {
  const params = new URLSearchParams();
  if (opts.marketId) params.set("market_id", opts.marketId);
  if (opts.agentId) params.set("agent_id", opts.agentId);
  if (opts.campaignId) params.set("campaign_id", opts.campaignId);
  const query = params.toString();
  const key = query ? `/api/follow-ups/summary?${query}` : "/api/follow-ups/summary";

  const { data, error, isLoading, mutate } = useSWR<FollowUpsSummary>(key, fetcher, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
    fallbackData: opts.fallback,
    keepPreviousData: true,
  });

  return {
    summary: data ?? opts.fallback ?? {
      total: 0,
      open: 0,
      in_progress: 0,
      resolved: 0,
      escalated: 0,
    },
    error,
    isLoading: isLoading && !data,
    mutate,
  };
}
