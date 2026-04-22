import useSWR from "swr";
import type { OrderFollowUpWithOrder } from "@/types/follow-up";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch follow-ups");
    return res.json();
  });

export interface FollowUpsQuery {
  marketId?: string | null;
  status?: string | null;
  agentId?: string | null;
  campaignId?: string | null;
  page?: number;
  limit?: number;
}

function buildFollowUpsKey(q: FollowUpsQuery): string {
  const params = new URLSearchParams();
  if (q.marketId) params.set("market_id", q.marketId);
  if (q.status) params.set("status", q.status);
  if (q.agentId) params.set("agent_id", q.agentId);
  if (q.campaignId) params.set("campaign_id", q.campaignId);
  if (q.page) params.set("page", String(q.page));
  if (q.limit) params.set("limit", String(q.limit));
  const qs = params.toString();
  return qs ? `/api/follow-ups?${qs}` : "/api/follow-ups";
}

export function useFollowUps(query: FollowUpsQuery) {
  const key = buildFollowUpsKey(query);
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
  });

  return {
    followUps: (data?.data ?? []) as OrderFollowUpWithOrder[],
    total: (data?.pagination?.total ?? 0) as number,
    page: (data?.pagination?.page ?? 1) as number,
    limit: (data?.pagination?.limit ?? 50) as number,
    error,
    isLoading,
    mutate,
  };
}
