import useSWR from "swr";
import type { OrderFollowUpWithHistory } from "@/types/follow-up";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch follow-up");
    return res.json();
  });

export function useFollowUpDetail(id: string | null) {
  const key = id ? `/api/follow-ups/${id}` : null;
  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 1000,
  });

  return {
    followUp: (data?.data ?? null) as OrderFollowUpWithHistory | null,
    error,
    isLoading,
    mutate,
  };
}
