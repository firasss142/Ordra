import useSWR from "swr";
import type { InventorySummary } from "@/app/api/inventory/summary/route";

export function useInventorySummary(options?: { marketId?: string }) {
  const params = new URLSearchParams();
  if (options?.marketId) params.set("market_id", options.marketId);
  const qs = params.toString();
  const key = `/api/inventory/summary${qs ? `?${qs}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<InventorySummary>(key, {
    revalidateOnFocus: false,
    refreshInterval: 120_000,
    dedupingInterval: 30_000,
  });

  return { inventory: data ?? null, error, isLoading, mutate };
}
