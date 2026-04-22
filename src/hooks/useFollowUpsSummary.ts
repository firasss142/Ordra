"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { FollowUpsSummary } from "@/lib/follow-ups/summary";

const summaryFetcher = async (url: string): Promise<FollowUpsSummary> => {
  const json = (await fetcher(url)) as { data: FollowUpsSummary };
  return json.data;
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

  const { data, error, isLoading, mutate } = useSWR<FollowUpsSummary>(key, summaryFetcher, {
    revalidateOnFocus: false,
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
