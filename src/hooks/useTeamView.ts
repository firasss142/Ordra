import useSWR from "swr";

interface TeamAgent {
  agent_id: string;
  full_name: string;
  is_actif: boolean;
  queue_size: number;
  today_actioned: number;
}

export function useTeamView(marketId?: string) {
  const params = marketId ? `?market_id=${marketId}` : "";
  const { data, error, isLoading, mutate } = useSWR(
    `/api/team${params}`,
    {
      refreshInterval: 60000,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  );

  return {
    agents: (data?.data ?? []) as TeamAgent[],
    error,
    isLoading,
    mutate,
  };
}
