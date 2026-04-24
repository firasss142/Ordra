import useSWR from "swr";
import type { CarrierTrackingSummary } from "@/app/api/warehouse/carrier-tracking/route";

export function useCarrierTracking(options?: { marketId?: string }) {
  const params = new URLSearchParams();
  if (options?.marketId) params.set("market_id", options.marketId);
  const qs = params.toString();
  const key = `/api/warehouse/carrier-tracking${qs ? `?${qs}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<CarrierTrackingSummary>(key, {
    revalidateOnFocus: false,
    refreshInterval: 120_000,
    dedupingInterval: 30_000,
  });

  return { tracking: data ?? null, error, isLoading, mutate };
}
