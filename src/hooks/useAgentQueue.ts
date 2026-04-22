import useSWR from "swr";

export interface AgentQueueBuckets {
  nouveau: number;
  tentative_1: number;
  tentative_2: number;
  tentative_3: number;
  tentative_total: number;
  rappel_prevu: number;
  livraison_planifiee: number;
  confirme: number;
  rejete: number;
  fermees: number;
}

export function useAgentQueue() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/agent/queue",
    {
      refreshInterval: 30000,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  );

  return {
    orders: (data?.orders ?? []) as Record<string, unknown>[],
    allOrders: (data?.allOrders ?? data?.orders ?? []) as Record<string, unknown>[],
    closedOrders: (data?.closedOrders ?? []) as Record<string, unknown>[],
    buckets: (data?.buckets ?? null) as AgentQueueBuckets | null,
    error,
    isLoading,
    mutate,
  };
}
