"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { TeamCommissions } from "@/lib/commissions/types";

export function buildTeamCommissionsKey(marketId: string, from: string, to: string): string {
  const p = new URLSearchParams({ market_id: marketId, from_date: from, to_date: to });
  return `/api/team/commissions?${p.toString()}`;
}

/** Commissions per agent for a period + all-time balances. Slow-moving; 5 min poll. */
export function useTeamCommissions(marketId: string | null, from: string, to: string) {
  const { data, error, isLoading, mutate } = useSWR<{ data: TeamCommissions }>(
    marketId ? buildTeamCommissionsKey(marketId, from, to) : null,
    fetcher,
    { refreshInterval: 300_000, revalidateOnFocus: false, keepPreviousData: true },
  );
  const tc = data?.data && "agents" in data.data ? data.data : null;
  return { commissions: tc, error, isLoading, mutate };
}
