"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";

export interface AgentCapacityRow {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  is_active: boolean;
  last_seen_at: string | null;
  last_action_at: string | null;
  queue_size: number;
  confirmation_rate: number;
  actioned_count: number;
}

export function useAgentCapacity(marketId: string | null) {
  const key = marketId ? `/api/agents/capacity?market_id=${marketId}` : null;
  const { data, error, isLoading, mutate } = useSWR<{ data: AgentCapacityRow[] }>(
    key,
    fetcher,
    {
      refreshInterval: 10_000,
      revalidateOnFocus: true,
      dedupingInterval: 3000,
    }
  );

  return {
    agents: data?.data ?? [],
    error,
    isLoading,
    mutate,
  };
}
