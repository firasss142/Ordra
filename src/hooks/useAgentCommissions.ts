"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { AgentCommissions } from "@/lib/commissions/types";

/** The agent's own commissions ("Mes commissions"). */
export function useAgentCommissions(days = 60) {
  const { data, error, isLoading, mutate } = useSWR<{ data: AgentCommissions }>(
    `/api/agent/commissions?days=${days}`,
    fetcher,
    { refreshInterval: 120_000, revalidateOnFocus: true, keepPreviousData: true },
  );
  const me = data?.data && "balance" in data.data ? data.data : null;
  return { me, error, isLoading, mutate };
}
