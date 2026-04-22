import useSWR from "swr";
import type { Lead, LeadHistoryEntry } from "@/types/lead";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch lead");
    return res.json();
  });

export interface LeadWithHistory extends Lead {
  history: LeadHistoryEntry[];
}

export function useLeadDetail(id: string | null) {
  const key = id ? `/api/leads/${id}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
  });

  return {
    lead: (data?.data ?? null) as LeadWithHistory | null,
    error,
    isLoading,
    mutate,
  };
}
