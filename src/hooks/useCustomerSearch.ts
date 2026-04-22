import { useEffect, useState } from "react";
import useSWR from "swr";
import type { CustomerSearchResult } from "@/types/follow-up";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to search customers");
    return res.json();
  });

/**
 * Debounced customer search by phone. Returns empty list while the query
 * is shorter than 3 chars. Callers pass in an optional marketId for
 * super_admin scoping.
 */
export function useCustomerSearch(rawPhone: string, marketId?: string | null) {
  const [debounced, setDebounced] = useState(rawPhone);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(rawPhone), 250);
    return () => clearTimeout(t);
  }, [rawPhone]);

  const trimmed = debounced.trim();
  const enabled = trimmed.length >= 3;

  const params = new URLSearchParams();
  if (enabled) params.set("phone", trimmed);
  if (marketId) params.set("market_id", marketId);

  const key = enabled ? `/api/customers/search?${params.toString()}` : null;
  const { data, error, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 500,
  });

  return {
    results: (data?.data ?? []) as CustomerSearchResult[],
    error,
    isLoading: enabled && isLoading,
    enabled,
  };
}
