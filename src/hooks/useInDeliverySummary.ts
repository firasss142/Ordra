import useSWR from "swr";
import type { InDeliverySummary } from "@/app/api/in-delivery/summary/route";

export function useInDeliverySummary(options?: { marketId?: string }) {
  const params = new URLSearchParams();
  if (options?.marketId) params.set("market_id", options.marketId);
  const qs = params.toString();
  const key = `/api/in-delivery/summary${qs ? `?${qs}` : ""}`;

  const { data, error, isLoading, mutate } = useSWR<InDeliverySummary>(key, {
    revalidateOnFocus: false,
    refreshInterval: 60_000,
    dedupingInterval: 15_000,
  });

  return { summary: data ?? null, error, isLoading, mutate };
}
