import useSWR from "swr";

interface AgentMetrics {
  actioned_count: number;
  confirmed_count: number;
  confirmation_rate: number;
  avg_attempts: number;
}

export function useAgentMetrics(
  fromDate: string,
  toDate: string,
  options?: { marketId?: string; agentId?: string }
) {
  const params = new URLSearchParams({ from_date: fromDate, to_date: toDate });
  if (options?.marketId) params.set("market_id", options.marketId);
  if (options?.agentId) params.set("agent_id", options.agentId);

  const { data, error, isLoading, mutate } = useSWR(
    `/api/team/metrics?${params.toString()}`,
    {
      revalidateOnFocus: false,
      dedupingInterval: 10000,
    }
  );

  return {
    metrics: (data?.data ?? null) as AgentMetrics | null,
    error,
    isLoading,
    mutate,
  };
}
