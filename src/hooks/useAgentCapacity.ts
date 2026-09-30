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
  /** Declared "I take orders". Null-safe: false before the migration lands. */
  is_available: boolean;
  available_since: string | null;
  /** Orders assigned to them today (market-local), manual ones included. */
  assigned_today: number;
  /** Their configured share of the day, or null when not using percentages. */
  share_pct: number | null;
  /** Declared AND beating — what the distributor actually checks. */
  receiving_orders: boolean;
}

export function useAgentCapacity(marketId: string | null) {
  const key = marketId
    ? marketId === "all"
      ? `/api/agents/capacity`
      : `/api/agents/capacity?market_id=${marketId}`
    : null;
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
