"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { AgentStatement } from "@/lib/commissions/types";

/** The agent's own commission statement ("Mes commissions"). */
export function useAgentCommissions(days = 90) {
  const { data, error, isLoading, mutate } = useSWR<{ data: AgentStatement }>(
    `/api/agent/commissions?days=${days}`,
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: true, keepPreviousData: true },
  );
  const me = data?.data && "owed" in data.data ? data.data : null;
  return { me, error, isLoading, mutate };
}
