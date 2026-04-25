import useSWR from "swr";
import type { Lead } from "@/types/lead";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch leads");
    return res.json();
  });

export interface LeadsQuery {
  marketId?: string | null;
  status?: string | null;
  source?: string | null;
  agentId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  campaignId?: string | null;
  hotOnly?: boolean;
  hasDuplicate?: boolean;
  page?: number;
  limit?: number;
}

function buildLeadsKey(q: LeadsQuery): string {
  const params = new URLSearchParams();
  if (q.marketId) params.set("market_id", q.marketId);
  if (q.status) params.set("status", q.status);
  if (q.source) params.set("source", q.source);
  if (q.agentId) params.set("agent_id", q.agentId);
  if (q.dateFrom) params.set("date_from", q.dateFrom);
  if (q.dateTo) params.set("date_to", q.dateTo);
  if (q.campaignId) params.set("campaign_id", q.campaignId);
  if (q.hotOnly) params.set("hot_only", "true");
  if (q.hasDuplicate) params.set("has_duplicate", "true");
  if (q.page) params.set("page", String(q.page));
  if (q.limit) params.set("limit", String(q.limit));
  const qs = params.toString();
  return qs ? `/api/leads?${qs}` : "/api/leads";
}

export function useLeads(query: LeadsQuery) {
  const key = buildLeadsKey(query);
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 2000,
  });

  return {
    leads: (data?.data ?? []) as Lead[],
    total: (data?.pagination?.total ?? 0) as number,
    page: (data?.pagination?.page ?? 1) as number,
    limit: (data?.pagination?.limit ?? 50) as number,
    error,
    isLoading,
    mutate,
  };
}
