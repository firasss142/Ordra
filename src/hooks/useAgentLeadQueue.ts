import useSWR from "swr";
import type { Lead } from "@/types/lead";

export interface AgentLeadQueueBuckets {
  nouveau: number;
  tentative_1: number;
  tentative_2: number;
  tentative_3: number;
  rappel_prevu: number;
  qualifie: number;
  gagne: number;
  perdu: number;
  fermees: number;
}

export function tentativeTotal(b: AgentLeadQueueBuckets): number {
  return b.tentative_1 + b.tentative_2 + b.tentative_3;
}

export function useAgentLeadQueue() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/agent/leads/queue",
    {
      refreshInterval: 30000,
      revalidateOnFocus: false,
      dedupingInterval: 2000,
    }
  );

  return {
    leads: (data?.leads ?? []) as Lead[],
    allLeads: (data?.allLeads ?? data?.leads ?? []) as Lead[],
    closedLeads: (data?.closedLeads ?? []) as Lead[],
    buckets: (data?.buckets ?? null) as AgentLeadQueueBuckets | null,
    error,
    isLoading,
    mutate,
  };
}
