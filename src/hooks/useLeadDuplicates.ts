"use client";

import useSWR from "swr";
import { fetcher } from "@/lib/swr-config";
import type { DuplicateResult } from "@/lib/leads/duplicates";

export function useLeadDuplicates(
  phone: string | null,
  marketId: string | null,
  excludeId?: string,
) {
  const params = new URLSearchParams();
  if (phone) params.set("phone", phone);
  if (marketId) params.set("market_id", marketId);
  if (excludeId) params.set("exclude_id", excludeId);

  const key =
    phone && marketId
      ? `/api/leads/duplicates?${params.toString()}`
      : null;

  const { data, error, isLoading } = useSWR<{ data: DuplicateResult[] }>(
    key,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 10000 },
  );

  return {
    duplicates: data?.data ?? [],
    isLoading,
    error,
  };
}
